// src/commands/admin/rifa.ts

import { 
    // Importações do discord.js
    ApplicationCommandType, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder, 
    Collection, 
    ModalSubmitInteraction, 
    ApplicationCommandOptionType,
    PermissionFlagsBits,
    ChannelType,
    TextChannel,
    ButtonInteraction,
    GuildMember
} from "discord.js";
import { Command } from "../../structs/types/Command";
import { prisma } from "../../prismaClient"; // Necessário para o botão 'buy-ticket'
import { ExtendedClient } from "../../structs/ExtendedClient";
import { Logger } from "../../utils/Logger"; // Importa o Logger

// --- IMPORTA O NOVO SERVICE ---
import {
    criarRifa,
    processarCompraRifa,
    sortearRifaDrak,
    cancelarRifa,
    finalizarRifaLoteria
} from "../../services/RifaService"; // Ajuste o caminho se necessário

// --- Funções helper (como getLotteryWinnerNumber) foram movidas para o Service ---

export default new Command({
    name: "rifa",
    description: "Gerencia o sistema de rifas.",
    type: ApplicationCommandType.ChatInput,
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,

    options: [
        { name: "criar", description: "Abre o formulário para criar uma nova rifa.", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "canal", description: "Canal onde a mensagem da rifa será postada.", type: ApplicationCommandOptionType.Channel, channel_types: [ChannelType.GuildText], required: true }] },
        { name: "sortear", description: "Sorteia um vencedor para uma rifa (método Drak).", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "id_rifa", description: "O ID da rifa que será sorteada.", type: ApplicationCommandOptionType.Integer, required: true }] },
        { name: "cancelar", description: "Cancela uma rifa ativa e notifica os participantes.", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "id_rifa", description: "O ID da rifa a ser cancelada.", type: ApplicationCommandOptionType.Integer, required: true }, { name: "motivo", description: "O motivo do cancelamento.", type: ApplicationCommandOptionType.String, required: true }] },
        { name: "finalizar-loteria", description: "Finaliza uma rifa 'loteria' com o número sorteado.", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "id_rifa", description: "O ID da rifa (método loteria) a ser finalizada.", type: ApplicationCommandOptionType.Integer, required: true }, { name: "numero_sorteado", description: "O número de 5 dígitos sorteado (ex: 12345).", type: ApplicationCommandOptionType.String, required: true }] }
    ],

    // --- FUNÇÃO 'RUN' (Refactorada) ---
    async run({ client, interaction, options }) {
        const subcomando = options.getSubcommand();

        // 1. CRIAR (UI - Mostrar Modal)
        // Esta lógica permanece aqui, pois é responsável por *mostrar* a UI.
        if (subcomando === "criar") {
            const canal = options.getChannel("canal") as TextChannel;
            if (!canal || !canal.isTextBased()) {
                return interaction.reply({ content: "O canal selecionado não é um canal de texto válido.", ephemeral: true });
            }
            const modalFinal = new ModalBuilder()
                 .setCustomId(`modal-rifa-criar_${canal.id}`)
                 .setTitle("Criar Nova Rifa");
            modalFinal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("rifa-premio").setLabel("Prêmio Principal").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("rifa-preco").setLabel("Preço (ex: 1.50)").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("rifa-bilhetes").setLabel("Total de Bilhetes (ex: 100)").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("rifa-metodo").setLabel("Método (drak / loteria:75)").setPlaceholder("drak (ou loteria:80 para meta 80%)").setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("premios-secundarios").setLabel("Prémios Secundários (Opcional)").setPlaceholder("TOP 1: Premio A\nBILHETE: 3x Premio C").setStyle(TextInputStyle.Paragraph).setRequired(false))
            );
            await interaction.showModal(modalFinal);
            return;
        }
        
        // 2. SORTEAR (Lógica movida para o Service)
        else if (subcomando === "sortear") {
            const id_rifa = options.getInteger("id_rifa", true);
            // O Service agora cuida do 'deferReply', 'try/catch' e 'editReply'
            await sortearRifaDrak(id_rifa, client, interaction);
            return;
        }

        // 3. CANCELAR (Lógica movida para o Service)
        else if (subcomando === "cancelar") {
            const id_rifa = options.getInteger("id_rifa", true);
            const motivo = options.getString("motivo", true);
            // O Service agora cuida do 'deferReply', 'try/catch' e 'editReply'
            await cancelarRifa(id_rifa, motivo, client, interaction);
            return;
        }
        
        // 4. FINALIZAR-LOTERIA (Lógica movida para o Service)
        else if (subcomando === "finalizar-loteria") {
            const id_rifa = options.getInteger("id_rifa", true);
            const numero_sorteado_input = options.getString("numero_sorteado", true);
             // O Service agora cuida do 'deferReply', 'try/catch' e 'editReply'
            await finalizarRifaLoteria(id_rifa, numero_sorteado_input, client, interaction);
            return;
        }
    },

    // --- MODALS (Refactorados) ---
    modals: new Collection<string, (interaction: ModalSubmitInteraction, client: ExtendedClient) => any>([
        
        // 1. CRIAR RIFA (Chama o Service)
        ["modal-rifa-criar_", async (interaction, client) => {
            // A lógica de negócio (quase 100 linhas) foi movida.
            // O Service cuida do 'deferReply', 'try/catch' e 'editReply'.
            await criarRifa(interaction, client);
        }],
        
        // 2. COMPRAR (Chama o Service)
        ["buy-modal_", async (interaction, client) => {
            // A lógica de negócio (quase 150 linhas) foi movida.
            // O Service cuida do 'deferReply', 'try/catch' e 'editReply'.
            await processarCompraRifa(interaction, client);
        }]
    ]),

    // --- BOTÕES (Lógica de UI permanece) ---
    buttons: new Collection<string, (interaction: ButtonInteraction, client: ExtendedClient) => any>([
        
        // Esta lógica é de UI (mostrar um modal), por isso permanece aqui.
        ["buy-ticket_", async (interaction, client) => {
            const [, rifaIdStr] = interaction.customId.split('_');
            const id_rifa = parseInt(rifaIdStr);
            if (isNaN(id_rifa)) {
                return interaction.reply({ content: "Erro: ID da rifa inválido.", ephemeral: true });
            }

            try {
                // Verifica o registo (lógica rápida de UI)
                const usuario = await prisma.usuario.findUnique({
                    where: { id_discord: interaction.user.id }
                });
                if (!usuario) {
                    return interaction.reply({
                        content: "Você precisa estar registado para comprar. Por favor, use o botão de registo no canal de boas-vindas primeiro!",
                        ephemeral: true
                    });
                }
                
                // Apenas mostra o modal
                const modal = new ModalBuilder()
                    .setCustomId(`buy-modal_${id_rifa}`)
                    .setTitle(`Comprar Bilhetes - Rifa #${id_rifa}`); 
                const quantidadeInput = new TextInputBuilder()
                    .setCustomId('buy-modal-quantidade')
                    .setLabel("Quantos bilhetes deseja comprar?")
                    .setPlaceholder('Ex: 5')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                const referralInput = new TextInputBuilder()
                    .setCustomId('referral-code')
                    .setLabel("Código de Indicador (Opcional)")
                    .setPlaceholder('Ex: LUIS-A1B2')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false);
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(quantidadeInput),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(referralInput)
                );
                await interaction.showModal(modal);

            } catch (error: any) {
                 Logger.error("Botao", `Erro ao MOSTRAR modal de compra (buy-ticket_ #${id_rifa})`, error);
                 if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: "Ocorreu um erro. Tente novamente.", ephemeral: true });
                 }
            }
        }]
    ])
});