// src/commands/admin/setup.ts

import { 
    ApplicationCommandType, 
    ApplicationCommandOptionType,
    PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, ButtonInteraction, Collection, ModalBuilder,
    TextInputBuilder, TextInputStyle, ModalSubmitInteraction,
    ChannelType, TextChannel, GuildMember
} from "discord.js";
import { Command } from "../../structs/types/Command";
import { prisma } from "../../prismaClient";
import { ExtendedClient } from "../../structs/ExtendedClient";

// --- IMPORTA O NOVO SERVICE ---
import { processarRegisto } from "../../services/SetupService"; // Ajuste o caminho se necessário
import { Logger } from "../../utils/Logger"; // Importa o Logger

// --- Lógica do Modal foi MOVIDA para o SetupService ---

export default new Command({
    name: "setup",
    description: "Comandos de configuração do servidor.",
    type: ApplicationCommandType.ChatInput,
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
    options: [
        {
            name: "postar-card-boas-vindas",
            description: "Posta a mensagem de registo no canal selecionado.",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "canal",
                    description: "O canal onde postar o card de registo.",
                    type: ApplicationCommandOptionType.Channel,
                    channel_types: [ChannelType.GuildText],
                    required: true
                }
            ]
        }
    ],

    // A função 'run' (postar card) é lógica de UI, permanece aqui.
    async run({ client, interaction, options }) {
        if (!interaction.inGuild()) return;
        const subcomando = options.getSubcommand();

        if (subcomando === "postar-card-boas-vindas") {
            const channel = options.getChannel("canal") as TextChannel;
            if (!channel) {
                return interaction.reply({ content: "Canal inválido.", ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle("👋 Bem-vindo(a) ao Servidor!")
                .setDescription(
                    "Para aceder a todos os canais e participar das nossas atividades, precisamos que complete um breve registo.\n\n" +
                    "Isto ajuda-nos a manter a comunidade segura e a identificar os participantes das rifas."
                )
                .addFields({
                    name: "Porquê Registar?",
                    value: "O registo é necessário para associar a sua conta do Discord às suas compras e bilhetes."
                })
                .setColor("Blue")
                .setFooter({ text: "Clique no botão abaixo para iniciar." });

            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId("onboarding-start-register")
                        .setLabel("Iniciar Registo")
                        .setStyle(ButtonStyle.Success)
                        .setEmoji("📝")
                );

            try {
                await channel.send({ embeds: [embed], components: [row] });
                await interaction.reply({ content: `Mensagem de boas-vindas postada em ${channel}.`, ephemeral: true });
            } catch (error) {
                Logger.error("Comando", "Falha ao postar card de boas-vindas", error);
                await interaction.reply({ content: "Não consegui enviar a mensagem nesse canal. Verifique as minhas permissões.", ephemeral: true });
            }
        }
    },

    // O botão (mostrar modal) é lógica de UI, permanece aqui.
    buttons: new Collection<string, (interaction: ButtonInteraction, client: ExtendedClient) => any>([
        ["onboarding-start-register", async (interaction, client) => {
            try {
                const user = await prisma.usuario.findUnique({
                    where: { id_discord: interaction.user.id }
                });

                if (user) {
                    return interaction.reply({
                        content: "Você já está registado! Não é necessário fazê-lo novamente.",
                        ephemeral: true
                    });
                }

                const modal = new ModalBuilder()
                    .setCustomId("onboarding-modal-submit")
                    .setTitle("Formulário de Registo");
                
                const nomeInput = new TextInputBuilder()
                    .setCustomId("cadastro-nome")
                    .setLabel("O seu nome completo")
                    .setPlaceholder("Ex: João Maria Silva")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                
                const emailInput = new TextInputBuilder()
                    .setCustomId("cadastro-email")
                    .setLabel("O seu melhor email")
                    .setPlaceholder("Ex: joao.silva@gmail.com")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(nomeInput),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(emailInput)
                );
                
                await interaction.showModal(modal);

            } catch (error: any) {
                Logger.error("Botao", "Falha ao mostrar modal de registo (onboarding-start-register)", error);
                if (!interaction.replied) {
                    await interaction.reply({ content: "Ocorreu um erro ao abrir o formulário. Tente novamente.", ephemeral: true });
                }
            }
        }]
    ]),

    // --- MODAL (Refactorado) ---
    modals: new Collection<string, (interaction: ModalSubmitInteraction, client: ExtendedClient) => any>([
        ["onboarding-modal-submit", async (interaction, client) => {
            
            // Toda a lógica de negócio foi movida.
            // O Service cuida do 'deferReply', 'try/catch' e 'editReply'.
            await processarRegisto(interaction, client);

        }]
    ])
});