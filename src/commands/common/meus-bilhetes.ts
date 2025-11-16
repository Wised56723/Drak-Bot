// src/commands/common/meus-bilhetes.ts

import { 
    ApplicationCommandType, 
    EmbedBuilder
} from "discord.js";
import { Command } from "../../structs/types/Command";
import { prisma } from "../../prismaClient";
import { Logger } from "../../utils/Logger"; // Importa o Logger

export default new Command({
    name: "meus-bilhetes",
    description: "Mostra seus bilhetes aprovados de rifas ativas.",
    type: ApplicationCommandType.ChatInput,
    dmPermission: true,

    async run({ client, interaction, options }) {

        if (interaction.guild) {
            return interaction.reply({
                content: "Este comando só pode ser usado na minha conversa privada (DM).",
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: false });
        
        const id_discord = interaction.user.id;

        try {
            const usuario = await prisma.usuario.findUnique({
                where: { id_discord: id_discord }
            });

            if (!usuario) {
                return interaction.editReply("Você não está cadastrado! Use o comando de registo primeiro.");
            }

            // --- ALTERAÇÃO 1: FILTRAGEM NA CONSULTA ---
            // Adicionado status: 'aprovada' ao 'where'.
            // Agora, a consulta SÓ retorna compras aprovadas de rifas ativas.
            const compras = await prisma.compras.findMany({
                where: { 
                    id_usuario_fk: id_discord,
                    status: 'aprovada', // Apenas compras aprovadas
                    rifa: {
                        status: { in: ['ativa', 'aguardando_sorteio'] } // Apenas rifas ativas
                    }
                },
                include: {
                    rifa: true,
                    bilhetes: true // Inclui os bilhetes de cada compra
                },
                orderBy: [
                    { rifa: { id_rifa: 'desc' } },
                    { data_compra: 'asc' }
                ]
            });

            if (compras.length === 0) {
                return interaction.editReply("Você não possui bilhetes aprovados para rifas ativas no momento.");
            }

            const embed = new EmbedBuilder()
                .setTitle(`Minhas Rifas Ativas`)
                .setColor("Blue")
                .setDescription("Aqui está um resumo dos seus bilhetes aprovados para rifas em andamento.");

            // --- ALTERAÇÃO 2: LÓGICA DE AGRUPAMENTO SIMPLIFICADA ---

            // 1. Agrupar as compras por ID da rifa
            const rifasAgrupadas: Record<number, typeof compras> = {};
            for (const compra of compras) {
                if (!rifasAgrupadas[compra.id_rifa_fk]) {
                    rifasAgrupadas[compra.id_rifa_fk] = [];
                }
                rifasAgrupadas[compra.id_rifa_fk].push(compra);
            }

            // 2. Iterar sobre cada Rifa agrupada
            for (const rifaId in rifasAgrupadas) {
                const comprasDaRifa = rifasAgrupadas[rifaId];
                const rifa = comprasDaRifa[0].rifa; // Pegar detalhes da rifa
                
                const bilhetesAprovados: string[] = [];

                // 3. Coletar todos os bilhetes
                // (Não precisamos mais verificar o status, pois a consulta já filtrou)
                for (const compra of comprasDaRifa) {
                    bilhetesAprovados.push(...compra.bilhetes.map(b => b.numero_bilhete));
                }

                // 4. Construir o campo de valor para o Embed
                let campoValor = "";

                if (bilhetesAprovados.length > 0) {
                    bilhetesAprovados.sort(); // Opcional: ordenar os bilhetes
                    campoValor += `✅ **Total Aprovado:** ${bilhetesAprovados.length} bilhete(s)\n`;
                    campoValor += `> \`\`\`${bilhetesAprovados.join(', ')}\`\`\`\n`;
                } else {
                     // Este bloco agora é redundante, mas serve como segurança
                    campoValor = "Nenhum bilhete aprovado encontrado para esta rifa.";
                }
                
                // 5. Adicionar ao Embed
                embed.addFields({ 
                    name: `Rifa #${rifaId}: ${rifa.nome_premio} (${rifa.status.toUpperCase()})`, 
                    value: campoValor 
                });
            }
            
            await interaction.editReply({ embeds: [embed] });

        } catch (error: any) {
            Logger.error("Comando", `Erro ao executar /meus-bilhetes para ${id_discord}`, error);
            await interaction.editReply("Ocorreu um erro inesperado ao buscar suas compras. 😢");
        }
    },
});