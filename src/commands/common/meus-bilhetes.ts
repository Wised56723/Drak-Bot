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
    description: "Mostra todos os seus bilhetes e compras de rifas.",
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

            const compras = await prisma.compras.findMany({
                where: { id_usuario_fk: id_discord },
                include: {
                    rifa: true,
                    bilhetes: true
                },
                orderBy: [
                    { rifa: { id_rifa: 'desc' } },
                    { data_compra: 'desc' }
                ]
            });

            if (compras.length === 0) {
                return interaction.editReply("Você ainda não fez nenhuma compra de rifa.");
            }

            const embed = new EmbedBuilder()
                .setTitle(`Minhas Compras e Bilhetes`)
                .setColor("Blue")
                .setDescription("Aqui está um resumo de todas as suas atividades de rifa.");

            const rifasAgrupadas: Record<number, typeof compras> = {};
            for (const compra of compras) {
                if (!rifasAgrupadas[compra.id_rifa_fk]) {
                    rifasAgrupadas[compra.id_rifa_fk] = [];
                }
                rifasAgrupadas[compra.id_rifa_fk].push(compra);
            }

            for (const rifaId in rifasAgrupadas) {
                const comprasDaRifa = rifasAgrupadas[rifaId];
                const nomePremio = comprasDaRifa[0].rifa.nome_premio; 
                
                let campoValor = "";

                for (const compra of comprasDaRifa) {
                    const data = new Date(compra.data_compra).toLocaleDateString('pt-BR');
                    
                    if (compra.status === 'aprovada') {
                        const numeros = compra.bilhetes.map(b => b.numero_bilhete).join(', ');
                        campoValor += `✅ **Aprovada** (ID: \`${compra.id_compra}\`) - ${compra.quantidade} bilhete(s)\n`;
                        campoValor += `> \`\`\`${numeros || 'Nenhum bilhete encontrado'}\`\`\`\n`;
                    } else if (compra.status === 'em_analise') {
                        campoValor += `⌛ **Em Análise** (ID: \`${compra.id_compra}\`) - ${compra.quantidade} bilhete(s)\n`;
                    } else if (compra.status === 'rejeitada') {
                        campoValor += `❌ **Rejeitada** (ID: \`${compra.id_compra}\`) - ${compra.quantidade} bilhete(s) - ${data}\n`;
                    }
                }
                
                embed.addFields({ name: `Rifa #${rifaId}: ${nomePremio}`, value: campoValor });
            }
            
            await interaction.editReply({ embeds: [embed] });

        } catch (error: any) {
            // Log com Logger
            Logger.error("Comando", `Erro ao executar /meus-bilhetes para ${id_discord}`, error);
            await interaction.editReply("Ocorreu um erro inesperado ao buscar suas compras. 😢");
        }
    },
});