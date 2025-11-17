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
    // Descrição atualizada
    description: "Mostra um resumo de quantos bilhetes você possui em rifas ativas.",
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

            // --- INÍCIO DA REATORAÇÃO ---

            // 1. Usamos 'groupBy' para agregar a contagem de bilhetes por rifa.
            //    Isto é muito mais eficiente do que carregar todos os bilhetes.
            const bilhetesAgregados = await prisma.compras.groupBy({
                by: ['id_rifa_fk'], // Agrupar por rifa
                where: {
                    id_usuario_fk: id_discord,
                    status: 'aprovada',
                    rifa: {
                        status: { in: ['ativa', 'aguardando_sorteio'] }
                    }
                },
                // Soma a 'quantidade' de todas as compras aprovadas para cada rifa
                _sum: {
                    quantidade: true
                }
            });

            if (bilhetesAgregados.length === 0) {
                return interaction.editReply("Você não possui bilhetes aprovados para rifas ativas no momento.");
            }

            // 2. Buscar os nomes e status das rifas encontradas
            const rifaIds = bilhetesAgregados.map(a => a.id_rifa_fk);
            const rifas = await prisma.rifa.findMany({
                where: { id_rifa: { in: rifaIds } },
                select: { id_rifa: true, nome_premio: true, status: true }
            });
            // Mapear para fácil acesso
            const rifaMap = new Map(rifas.map(r => [r.id_rifa, r]));


            // 3. Construir o Embed com o sumário
            const embed = new EmbedBuilder()
                .setTitle(`Minhas Rifas Ativas`)
                .setColor("Blue")
                .setDescription("Aqui está um resumo dos seus bilhetes aprovados para rifas em andamento.");

            for (const agregado of bilhetesAgregados) {
                const rifa = rifaMap.get(agregado.id_rifa_fk);
                const totalBilhetes = agregado._sum.quantidade || 0; // Total de bilhetes

                if (rifa && totalBilhetes > 0) {
                    // Adiciona um campo para cada rifa, mostrando apenas a contagem
                    embed.addFields({
                        name: `Rifa #${rifa.id_rifa}: ${rifa.nome_premio} (${rifa.status.toUpperCase()})`,
                        value: `✅ Você possui **${totalBilhetes}** bilhete(s) aprovado(s) nesta rifa.`
                    });
                }
            }
            
            // --- FIM DA REATORAÇÃO ---
            
            await interaction.editReply({ embeds: [embed] });

        } catch (error: any) {
            Logger.error("Comando", `Erro ao executar /meus-bilhetes para ${id_discord}`, error);
            await interaction.editReply("Ocorreu um erro inesperado ao buscar suas compras. 😢");
        }
    },
});