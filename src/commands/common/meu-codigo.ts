// src/commands/common/meu-codigo.ts

import { 
    ApplicationCommandType, 
    EmbedBuilder
} from "discord.js";
import { Command } from "../../structs/types/Command";
import { prisma } from "../../prismaClient";
import { Logger } from "../../utils/Logger";

export default new Command({
    name: "meu-codigo",
    description: "Mostra o seu código de indicação para convidar amigos.",
    type: ApplicationCommandType.ChatInput,
    dmPermission: true, // Permite usar nas DMs do bot também

    async run({ interaction }) {
        // Resposta efêmera para garantir privacidade
        await interaction.deferReply({ ephemeral: true });
        
        const id_discord = interaction.user.id;

        try {
            // Busca o utilizador e apenas o campo referral_code
            const usuario = await prisma.usuario.findUnique({
                where: { id_discord: id_discord },
                select: { nome: true, referral_code: true }
            });

            // Validação: Utilizador não registado
            if (!usuario) {
                return interaction.editReply("❌ Você não está registado! Por favor, faça o registo no servidor primeiro.");
            }

            // Validação: Código inexistente (caso raro)
            if (!usuario.referral_code) {
                return interaction.editReply("⚠️ Você está registado, mas não possui um código de indicação ativo. Contacte um administrador.");
            }

            // Criação do Embed de resposta
            const embed = new EmbedBuilder()
                .setTitle(`🎫 Seu Código de Indicação`)
                .setDescription(`Partilhe este código com os seus amigos! Se eles o usarem ao comprar rifas, você pode ganhar bilhetes bónus.`)
                .addFields({
                    name: "O Seu Código",
                    value: `\`\`\`${usuario.referral_code}\`\`\``, // Bloco de código para facilitar copiar
                    inline: false
                })
                .setColor("Green")
                .setFooter({ text: "Toque no código acima para copiar." })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error: any) {
            Logger.error("Comando", `Erro ao buscar código de referência para ${id_discord}`, error);
            await interaction.editReply("❌ Ocorreu um erro inesperado ao buscar o seu código. Tente novamente mais tarde.");
        }
    },
});