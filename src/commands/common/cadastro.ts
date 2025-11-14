import { 
    ApplicationCommandType, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder, 
    Collection, 
    ModalSubmitInteraction 
} from "discord.js";
import { Command } from "../../structs/types/Command";
import db = require("../../database.js");
import { RunResult } from "sqlite3";
import { ExtendedClient } from "../../structs/ExtendedClient.js"; // Importe o client

const emailRegex = /\S+@\S+\.\S+/;

export default new Command({
    name: "cadastro",
    description: "Cadastre-se no sistema de rifas.",
    type: ApplicationCommandType.ChatInput,
    dmPermission: true, 

    async run({ interaction }) {
        if (interaction.guild) {
            return interaction.reply({
                content: "Este comando só pode ser usado na minha conversa privada (DM) para evitar poluição em chats públicos.",
                ephemeral: true
            });
        }
        
        const modal = new ModalBuilder()
            .setCustomId("modal-cadastro") 
            .setTitle("Formulário de Cadastro");

        const nomeInput = new TextInputBuilder()
            .setCustomId("cadastro-nome")
            .setLabel("Qual é o seu nome completo?")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const emailInput = new TextInputBuilder()
            .setCustomId("cadastro-email")
            .setLabel("Qual é o seu e-mail?")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("nome@email.com")
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(nomeInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(emailInput)
        );

        await interaction.showModal(modal);
    },

    // MODIFICADO: Adiciona o parâmetro 'client', mesmo sem usar
    modals: new Collection<string, (interaction: ModalSubmitInteraction, client: ExtendedClient) => any>([
        ["modal-cadastro", async (interaction, client) => {
            
            if (interaction.guild) {
                return interaction.reply({
                    content: "Este comando só pode ser usado na minha conversa privada (DM).",
                    ephemeral: true
                });
            }

            const nome = interaction.fields.getTextInputValue("cadastro-nome");
            const email = interaction.fields.getTextInputValue("cadastro-email");
            const id_discord = interaction.user.id;

            if (!emailRegex.test(email)) {
                return interaction.reply({
                    content: "Esse email não parece válido. Por favor, tente novamente com um formato válido (ex: nome@email.com).",
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            const sql = `INSERT OR IGNORE INTO Usuarios (id_discord, nome, email) VALUES (?, ?, ?)`;
            const params = [id_discord, nome, email];

            try {
                const changes = await new Promise<number>((resolve, reject) => {
                    db.run(sql, params, function(this: RunResult, err: Error | null) {
                        if (err) {
                            console.error("[ERRO DB]:", err.message);
                            return reject(err);
                        }
                        resolve(this.changes);
                    });
                });

                if (changes === 0) {
                    await interaction.editReply('Você já está cadastrado no sistema!');
                } else {
                    await interaction.editReply(`Bem-vindo, ${nome}! Seu cadastro foi concluído com sucesso. 🎉`);
                }

            } catch (err) {
                await interaction.editReply('Ocorreu um erro ao tentar te cadastrar. 😢 Tente novamente mais tarde.');
            }
        }]
    ])
});