// src/commands/admin/gestao.ts

import { 
    ApplicationCommandType, 
    ApplicationCommandOptionType,
    PermissionFlagsBits, TextChannel, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ButtonInteraction, Collection, ModalBuilder,
    TextInputBuilder, TextInputStyle, ModalSubmitInteraction
} from "discord.js";
import { Command } from "../../structs/types/Command";
import { prisma } from "../../prismaClient"; 
import { ExtendedClient } from "../../structs/ExtendedClient";

// Importa a lógica de negócio do Service
import { 
    aprovarCompra, 
    rejeitarCompra, 
    getPendingCompraIds 
} from "../../services/GestaoService";
// Importa o novo Logger
import { Logger } from "../../utils/Logger";

export default new Command({
    name: "gestao",
    description: "Gerencia compras e pagamentos.",
    type: ApplicationCommandType.ChatInput,
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
    options: [
        {
            name: "listar",
            description: "Lista todas as compras pendentes (em análise).",
            type: ApplicationCommandOptionType.Subcommand,
        },
        // --- NOVO SUB-COMANDO ADICIONADO ---
        {
            name: "purgar-rifa",
            description: "[PERIGOSO] Apaga permanentemente uma rifa finalizada ou cancelada e todos os seus dados.",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "id_rifa",
                    description: "O ID da rifa a ser apagada.",
                    type: ApplicationCommandOptionType.Integer,
                    required: true
                }
            ]
        }
        // --- FIM DO NOVO SUB-COMANDO ---
    ],
    async run({ client, interaction, options }) {
        const subcomando = options.getSubcommand();
        
        if (subcomando === "listar") {
            await interaction.deferReply({ ephemeral: true });
            try {
                const compras = await prisma.compras.findMany({
                    where: { status: 'em_analise' },
                    include: {
                        usuario: { select: { nome: true } }, 
                        rifa: { select: { nome_premio: true } }
                    },
                    orderBy: { data_compra: 'asc' }
                });

                if (compras.length === 0) {
                    return interaction.editReply("Não há nenhuma compra pendente no momento.");
                }

                const embed = new EmbedBuilder()
                    .setTitle(`Compras Pendentes (Total: ${compras.length})`)
                    .setColor("Orange")
                    .setTimestamp();
                
                let description = "";
                compras.forEach((compra) => {
                    description += 
                        `**ID: \`${compra.id_compra}\`** - Rifa: \`#${compra.id_rifa_fk}\` (${compra.rifa.nome_premio})\n` +
                        `> **Usuário:** ${compra.usuario.nome} (<@${compra.id_usuario_fk}>) | **Qtd:** ${compra.quantidade}\n\n`;
                });

                embed.setDescription(description.substring(0, 4096));

                const rowLote = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder().setCustomId('gestao-aprovar-lote-modal').setLabel('Aprovar por IDs').setStyle(ButtonStyle.Success).setEmoji('✅'),
                        new ButtonBuilder().setCustomId('gestao-rejeitar-lote-modal').setLabel('Rejeitar por IDs').setStyle(ButtonStyle.Danger).setEmoji('❌')
                    );
                const rowTodos = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder().setCustomId('gestao-aprovar-todos-prompt').setLabel('Aprovar TODAS Pendentes').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('gestao-rejeitar-todos-prompt').setLabel('Rejeitar TODAS Pendentes').setStyle(ButtonStyle.Danger)
                    );
                
                await interaction.editReply({ embeds: [embed], components: [rowLote, rowTodos] });

            } catch (error: any) {
                Logger.error("Comando", "Falha ao executar /gestao listar", error);
                await interaction.editReply(`❌ Erro ao listar compras: ${error.message}`);
            }
        }
        
        // --- NOVA LÓGICA DO SUB-COMANDO 'PURGAR-RIFA' ---
        else if (subcomando === "purgar-rifa") {
            const id_rifa = options.getInteger("id_rifa", true);
            await interaction.deferReply({ ephemeral: true });

            const rifa = await prisma.rifa.findUnique({
                where: { id_rifa: id_rifa },
                select: { status: true }
            });

            if (!rifa) {
                return interaction.editReply(`❌ Rifa #${id_rifa} não encontrada.`);
            }

            // Medida de segurança: Só permitir apagar rifas que já terminaram.
            if (rifa.status === 'ativa' || rifa.status === 'aguardando_sorteio') {
                return interaction.editReply(`❌ A Rifa #${id_rifa} ainda está ativa! Apenas rifas 'finalizada' ou 'cancelada' podem ser apagadas.`);
            }

            try {
                // Graças ao 'onDelete: Cascade', isto apaga TUDO:
                // Rifa -> Compras -> Bilhetes
                // Rifa -> PremiosInstantaneos
                await prisma.rifa.delete({
                    where: { id_rifa: id_rifa }
                });
                
                Logger.info("Comando", `[PURGE] Rifa #${id_rifa} e todos os dados associados foram apagados.`);
                await interaction.editReply(`✅ A Rifa #${id_rifa} (Status: ${rifa.status}) e todos os seus dados (compras, bilhetes) foram permanentemente apagados.`);

            } catch (error: any) {
                Logger.error("Comando", `[PURGE] Falha ao purgar a rifa #${id_rifa}`, error);
                await interaction.editReply(`❌ Ocorreu um erro ao apagar a rifa: ${error.message}`);
            }
        }
        // --- FIM DA NOVA LÓGICA ---
    },

    // Botões e Modals (NÃO MUDAM)
    buttons: new Collection<string, (interaction: ButtonInteraction, client: ExtendedClient) => any>([
        // ... (código dos botões 'log-approve_', 'log-reject_', etc. - sem alterações) ...
        ["log-approve_", async (interaction, client) => {
            await interaction.deferUpdate(); 
            if (!interaction.message) {
                Logger.error("Botao", "Interaction message é null (log-approve_)", new Error("Interaction message null"));
                return;
            }
            
            const [, id_compra_str] = interaction.customId.split('_');
            const id_compra = parseInt(id_compra_str);
            if (isNaN(id_compra)) {
                return interaction.followUp({ content: "Erro de ID no botão.", ephemeral: true });
            }

            try {
                // Chama o Service
                const msg = await aprovarCompra(id_compra, client);
                
                const originalEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(originalEmbed)
                    .setTitle(`✅ COMPRA #${id_compra} APROVADA`)
                    .setColor("Green")
                    .setDescription(
                        (originalEmbed.description || "") + 
                        `\n\n**Aprovada por:** <@${interaction.user.id}>\n**Detalhes:** ${msg}`
                    );
                await interaction.message.edit({ embeds: [newEmbed], components: [] });
            } catch (error: any) {
                Logger.error("Botao", `Erro ao processar log-approve_ (ID: ${id_compra})`, error);
                await interaction.followUp({ content: `❌ Erro ao aprovar #${id_compra}: ${error.message}`, ephemeral: true });
            }
        }],
        ["log-reject_", async (interaction, client) => {
            try {
                const [, id_compra_str] = interaction.customId.split('_');
                const id_compra = parseInt(id_compra_str);

                const modal = new ModalBuilder()
                    .setCustomId(`log-reject-modal_${id_compra}`)
                    .setTitle(`Rejeitar Compra #${id_compra}`);
                
                const motivoInput = new TextInputBuilder()
                    .setCustomId('log-reject-motivo')
                    .setLabel('Motivo da Rejeição')
                    .setPlaceholder('Ex: Pagamento não recebido.')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);
                
                modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(motivoInput));
                await interaction.showModal(modal);

            } catch (error: any) {
                Logger.error("Botao", "Falha ao MOSTRAR o modal de rejeição (log-reject_)", error);
            }
        }],
        
        // Botões de Lote (do /gestao listar)
        ["gestao-aprovar-lote-modal", (interaction) => {
            const modal = new ModalBuilder()
                .setCustomId('gestao-aprovar-lote-submit')
                .setTitle('Aprovar Compras por IDs');
            const idsInput = new TextInputBuilder()
                .setCustomId('lote-ids-aprovar')
                .setLabel('IDs das compras (separados por vírgula)')
                .setPlaceholder('Ex: 1, 2, 5, 8')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(idsInput));
            interaction.showModal(modal);
        }],
        ["gestao-rejeitar-lote-modal", (interaction) => {
            const modal = new ModalBuilder()
                .setCustomId('gestao-rejeitar-lote-submit')
                .setTitle('Rejeitar Compras por IDs');
            const idsInput = new TextInputBuilder()
                .setCustomId('lote-ids-rejeitar')
                .setLabel('IDs das compras (separados por vírgula)')
                .setPlaceholder('Ex: 3, 4, 7')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            const motivoInput = new TextInputBuilder()
                .setCustomId('lote-motivo')
                .setLabel('Motivo da Rejeição (único para todos)')
                .setPlaceholder('Ex: Pagamento não identificado.')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(idsInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(motivoInput)
            );
            interaction.showModal(modal);
        }],
        ["gestao-aprovar-todos-prompt", async (interaction) => {
            const pendingIds = await getPendingCompraIds(); // Chama o service
            if (pendingIds.length === 0) {
                return interaction.reply({ content: "Não há mais compras pendentes para aprovar.", ephemeral: true });
            }
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId('gestao-aprovar-todos-EXECUTE').setLabel(`Sim, aprovar TODAS (${pendingIds.length})`).setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('gestao-cancelar-acao').setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({
                content: `**CONFIRMAÇÃO:** Tem certeza que deseja aprovar **TODAS** as ${pendingIds.length} compras pendentes?`,
                components: [row],
                ephemeral: true
            });
        }],
        ["gestao-rejeitar-todos-prompt", async (interaction) => {
            const pendingIds = await getPendingCompraIds(); // Chama o service
            if (pendingIds.length === 0) {
                return interaction.reply({ content: "Não há mais compras pendentes para rejeitar.", ephemeral: true });
            }
            const modal = new ModalBuilder()
                .setCustomId('gestao-rejeitar-todos-SUBMIT')
                .setTitle(`Rejeitar TODAS (${pendingIds.length}) Compras`);
            const motivoInput = new TextInputBuilder()
                .setCustomId('lote-motivo-todos')
                .setLabel(`Motivo para rejeitar TODAS as ${pendingIds.length} compras:`)
                .setPlaceholder('Ex: Fim do prazo de pagamento.')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(motivoInput));
            await interaction.showModal(modal);
        }],
        ["gestao-cancelar-acao", (interaction) => {
            interaction.deleteReply();
        }],
        ["gestao-aprovar-todos-EXECUTE", async (interaction, client) => {
            await interaction.deferReply({ ephemeral: true });
            const ids = await getPendingCompraIds(); // Chama o service
            let successLog = "";
            let errorLog = "";
            for (const id of ids) {
                try {
                    const msg = await aprovarCompra(id, client); // Chama o service
                    successLog += `**ID \`${id}\`:** ${msg}\n`;
                } catch (error: any) {
                    Logger.error("Botao", `Falha no lote 'Aprovar Todos' (ID: ${id})`, error);
                    errorLog += `**ID \`${id}\`:** ${error.message}\n`;
                }
            }
            const embed = new EmbedBuilder().setTitle("Processamento 'Aprovar Todos' Concluído").setColor("Green").setTimestamp();
            if (successLog) embed.addFields({ name: "✅ Sucessos", value: successLog.substring(0, 1024) });
            if (errorLog) embed.addFields({ name: "❌ Falhas", value: errorLog.substring(0, 1024) });
            await interaction.editReply({ embeds: [embed] });
        }]
    ]),
    
    modals: new Collection<string, (interaction: ModalSubmitInteraction, client: ExtendedClient) => any>([
        // ... (código dos modals 'log-reject-modal_', 'gestao-aprovar-lote-submit', etc. - sem alterações) ...
        ["log-reject-modal_", async (interaction, client) => {
            await interaction.deferUpdate();
            if (!interaction.message) {
                Logger.error("Modal", "Interaction message é null (log-reject-modal_)", new Error("Interaction message null"));
                return;
            }

            const [, id_compra_str] = interaction.customId.split('_');
            const id_compra = parseInt(id_compra_str);
            const motivo = interaction.fields.getTextInputValue("log-reject-motivo");

            if (isNaN(id_compra)) {
                return interaction.followUp({ content: "Erro de ID no modal.", ephemeral: true });
            }

            try {
                // Chama o Service
                const msg = await rejeitarCompra(id_compra, motivo, client);
                
                const originalEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(originalEmbed)
                    .setTitle(`❌ COMPRA #${id_compra} REJEITADA`)
                    .setColor("Red")
                    .setDescription(
                        (originalEmbed.description || "") + 
                        `\n\n**Rejeitada por:** <@${interaction.user.id}>\n**Motivo:** ${motivo}`
                    );
                await interaction.message.edit({ embeds: [newEmbed], components: [] });
            } catch (error: any) {
                Logger.error("Modal", `Erro ao processar log-reject-modal_ (ID: ${id_compra})`, error);
                await interaction.followUp({ content: `❌ Erro ao rejeitar #${id_compra}: ${error.message}`, ephemeral: true });
            }
        }],

        // Modal: Aprovação em Lote
        ["gestao-aprovar-lote-submit", async (interaction, client) => {
            await interaction.deferReply({ ephemeral: true });
            const idsString = interaction.fields.getTextInputValue("lote-ids-aprovar");
            const ids = idsString.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            if (ids.length === 0) return interaction.editReply("Nenhum ID numérico válido foi fornecido.");
            
            let successLog = "";
            let errorLog = "";
            for (const id of ids) {
                try {
                    const msg = await aprovarCompra(id, client); // Chama o service
                    successLog += `**ID \`${id}\`:** ${msg}\n`;
                } catch (error: any) {
                    Logger.error("Modal", `Falha no lote 'Aprovar' (ID: ${id})`, error);
                    errorLog += `**ID \`${id}\`:** ${error.message}\n`;
                }
            }
            const embed = new EmbedBuilder().setTitle("Processamento de Lote (Aprovação) Concluído").setColor("Green").setTimestamp();
            if (successLog) embed.addFields({ name: "✅ Sucessos", value: successLog });
            if (errorLog) embed.addFields({ name: "❌ Falhas", value: errorLog });
            await interaction.editReply({ embeds: [embed] });
        }],

        // Modal: Rejeição em Lote
        ["gestao-rejeitar-lote-submit", async (interaction, client) => {
            await interaction.deferReply({ ephemeral: true });
            const idsString = interaction.fields.getTextInputValue("lote-ids-rejeitar");
            const motivo = interaction.fields.getTextInputValue("lote-motivo");
            const ids = idsString.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            if (ids.length === 0) return interaction.editReply("Nenhum ID numérico válido foi fornecido.");
            if (!motivo) return interaction.editReply("O motivo é obrigatório.");

            let successLog = "";
            let errorLog = "";
            for (const id of ids) {
                try {
                    const msg = await rejeitarCompra(id, motivo, client); // Chama o service
                    successLog += `**ID \`${id}\`:** ${msg}\n`;
                } catch (error: any) {
                    Logger.error("Modal", `Falha no lote 'Rejeitar' (ID: ${id})`, error);
                    errorLog += `**ID \`${id}\`:** ${error.message}\n`;
                }
            }
            const embed = new EmbedBuilder().setTitle("Processamento de Lote (Rejeição) Concluído").setColor("Red").setTimestamp();
            if (successLog) embed.addFields({ name: "✅ Sucessos", value: successLog });
            if (errorLog) embed.addFields({ name: "❌ Falhas", value: errorLog });
            await interaction.editReply({ embeds: [embed] });
        }],

        // Modal: Rejeição de TODOS
        ["gestao-rejeitar-todos-SUBMIT", async (interaction, client) => {
            await interaction.deferReply({ ephemeral: true });
            const motivo = interaction.fields.getTextInputValue("lote-motivo-todos");
            const ids = await getPendingCompraIds(); // Chama o service
            if (!motivo) return interaction.editReply("O motivo é obrigatório.");
            if (ids.length === 0) return interaction.editReply("Não há mais compras para rejeitar.");
            
            let successLog = "";
            let errorLog = "";
            for (const id of ids) {
                try {
                    const msg = await rejeitarCompra(id, motivo, client); // Chama o service
                    successLog += `**ID \`${id}\`:** ${msg}\n`;
                } catch (error: any) {
                    Logger.error("Modal", `Falha no lote 'Rejeitar Todos' (ID: ${id})`, error);
                    errorLog += `**ID \`${id}\`:** ${error.message}\n`;
                }
            }
            const embed = new EmbedBuilder().setTitle("Processamento 'Rejeitar Todos' Concluído").setColor("Red").setTimestamp();
            if (successLog) embed.addFields({ name: "✅ Sucessos", value: successLog.substring(0, 1024) });
            if (errorLog) embed.addFields({ name: "❌ Falhas", value: errorLog.substring(0, 1024) });
            await interaction.editReply({ embeds: [embed] });
        }]
    ])
});