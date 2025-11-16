import { 
    ApplicationCommandType, 
    ApplicationCommandOptionType,
    // ... (outras importações discord.js não mudam) ...
    PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, ButtonInteraction, Collection, ModalBuilder,
    TextInputBuilder, TextInputStyle, ModalSubmitInteraction,
    ChannelType, TextChannel, GuildMember
} from "discord.js";
import { Command } from "../../structs/types/Command";
import { prisma } from "../../prismaClient";
import { ExtendedClient } from "../../structs/ExtendedClient";
import { config } from "../..";
import crypto from "crypto"; // NOVO: Para gerar o código

const emailRegex = /\S+@\S+\.\S+/;

// ... (opções do comando 'run' não mudam) ...
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

    // ... (função 'run' não muda) ...
    async run({ client, interaction, options }) {
        // ... (código para postar o card não muda) ...
    },

    // ... (handler do botão 'onboarding-start-register' não muda) ...
    buttons: new Collection<string, (interaction: ButtonInteraction, client: ExtendedClient) => any>([
        ["onboarding-start-register", async (interaction, client) => {
            // ... (código para verificar utilizador e mostrar modal não muda) ...
        }]
    ]),

    // --- LÓGICA DO MODAL ATUALIZADA PARA GERAR CÓDIGO ---
    modals: new Collection<string, (interaction: ModalSubmitInteraction, client: ExtendedClient) => any>([
        ["onboarding-modal-submit", async (interaction, client) => {
            
            const nome = interaction.fields.getTextInputValue("cadastro-nome");
            const email = interaction.fields.getTextInputValue("cadastro-email");
            const id_discord = interaction.user.id;

            if (!interaction.inGuild()) {
                return interaction.reply({ content: "Esta interação deve ocorrer dentro de um servidor.", ephemeral: true });
            }
            if (!emailRegex.test(email)) {
                return interaction.reply({ content: "Esse email não parece válido.", ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            // --- NOVO: Gerar Código de Indicação ---
            // Tenta criar um código com base no nome, ex: "LUIS-A1B2"
            const nomeBase = nome.split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').substring(0, 5);
            let referralCode = `${nomeBase}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
            
            // Em caso de colisão (raro), apenas usa um código aleatório
            const existingCode = await prisma.usuario.findUnique({ where: { referral_code: referralCode } });
            if (existingCode) {
                referralCode = `USER-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            }
            // --- FIM DA GERAÇÃO DE CÓDIGO ---

            try {
                // 1. Guardar no DB (com o código)
                await prisma.usuario.create({
                    data: {
                        id_discord: id_discord,
                        nome: nome,
                        email: email,
                        referral_code: referralCode // Guarda o código
                    }
                });

                // 2. Adicionar a Função (Role)
                const roleId = config.membroRegistadoRoleID;
                if (!roleId) {
                    console.error("ERRO CRÍTICO: 'membroRegistadoRoleID' não definido no config.json");
                    return interaction.editReply("Registo salvo, mas ocorreu um erro ao atualizar as suas permissões. Contacte um admin.");
                }
                const member = interaction.member as GuildMember;
                await member.roles.add(roleId);

                // 3. Sucesso (com o código)
                await interaction.editReply(
                    `Registo concluído com sucesso, ${nome}! 🎉\n` +
                    `Você agora tem acesso a todos os canais do servidor.\n\n` +
                    `**O seu Código de Indicador é: \`${referralCode}\`**\n` +
                    `Partilhe-o com amigos! Se eles o usarem numa compra acima de R$ 10,00, você ganha um bilhete grátis!`
                );

            } catch (err: any) {
                if (err.code === 'P2002') {
                     // ... (lógica de erro P2002 não muda) ...
                } else {
                    console.error("Erro ao guardar no DB ou adicionar função:", err);
                    await interaction.editReply('Ocorreu um erro ao finalizar o seu registo. 😢 Tente novamente ou contacte um admin.');
                }
            }
        }]
    ])
});