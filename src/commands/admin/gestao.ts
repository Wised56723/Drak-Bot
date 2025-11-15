import { 
    ApplicationCommandType, 
    ApplicationCommandOptionType,
    PermissionFlagsBits,
    TextChannel,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ButtonInteraction,
    Collection,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ModalSubmitInteraction
} from "discord.js";
import { Command } from "../../structs/types/Command";
import db = require("../../database.js");
import { RunResult } from "sqlite3";
import { updateRaffleMessage, countBilhetesVendidos } from "../../utils/RaffleEmbed";
import { ExtendedClient } from "../../structs/ExtendedClient";

// --- Interfaces (Sem mudança) ---
interface Compra {
    id_compra: number;
    id_rifa_fk: number;
    id_usuario_fk: string;
    quantidade: number;
    status: string;
    data_compra: string;
}
interface Rifa {
    id_rifa: number;
    total_bilhetes: number;
}

// --- Funções Helper (Sem mudança) ---
function gerarNumerosBilhetes(totalBilhetesRifa: number, inicio: number, quantidade: number) {
    const padding = String(totalBilhetesRifa - 1).length;
    const numeros: string[] = [];
    for (let i = 0; i < quantidade; i++) {
        const numero = (inicio + i + 1);
        numeros.push(String(numero).padStart(padding, '0'));
    }
    return numeros;
}

// --- LÓGICA DE APROVAÇÃO (Reutilizável) ---
async function aprovarCompra(id_compra: number, client: ExtendedClient): Promise<string> {
    return new Promise((resolve, reject) => {
        db.serialize(async () => {
            try {
                await new Promise<void>((res, rej) => db.run("BEGIN TRANSACTION", (err) => err ? rej(err) : res()));

                const compra: Compra = await new Promise((res, rej) => {
                    db.get("SELECT * FROM Compras WHERE id_compra = ?", [id_compra], (err, row: Compra) => err ? rej(err) : res(row));
                });

                if (!compra) throw new Error("Compra não encontrada.");
                if (compra.status !== 'em_analise') throw new Error(`Já está com status '${compra.status}'.`);

                const rifa: Rifa = await new Promise((res, rej) => {
                    db.get("SELECT id_rifa, total_bilhetes FROM Rifas WHERE id_rifa = ?", [compra.id_rifa_fk], (err, row: Rifa) => err ? rej(err) : res(row));
                });

                const vendidos = await countBilhetesVendidos(compra.id_rifa_fk);
                if (vendidos + compra.quantidade > rifa.total_bilhetes) {
                    throw new Error(`Excede o total! (${vendidos} + ${compra.quantidade} > ${rifa.total_bilhetes})`);
                }

                await new Promise<void>((res, rej) => {
                    db.run("UPDATE Compras SET status = 'aprovada' WHERE id_compra = ?", [id_compra], (err) => err ? rej(err) : res());
                });

                const novosNumeros = gerarNumerosBilhetes(rifa.total_bilhetes, vendidos, compra.quantidade);
                const stmt = db.prepare("INSERT INTO Bilhetes (id_compra_fk, numero_bilhete) VALUES (?, ?)");
                for (const numero of novosNumeros) {
                    await new Promise<void>((res, rej) => stmt.run([id_compra, numero], (err) => err ? rej(err) : res()));
                }
                await new Promise<void>((res, rej) => stmt.finalize((err) => err ? rej(err) : res()));

                await new Promise<void>((res, rej) => db.run("COMMIT", (err) => err ? rej(err) : res()));

                try {
                    const user = await client.users.fetch(compra.id_usuario_fk);
                    const dmEmbed = new EmbedBuilder()
                        .setTitle(`✅ Compra Aprovada (Rifa #${compra.id_rifa_fk})`)
                        .setDescription(`Sua compra de **${compra.quantidade} bilhete(s)** foi aprovada!`)
                        .addFields({ name: "Seus Números da Sorte", value: `\`\`\`${novosNumeros.join(', ')}\`\`\`` })
                        .setColor("Green")
                        .setTimestamp();
                    await user.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    console.error("Erro ao enviar DM (aprovar):", dmError);
                }

                await updateRaffleMessage(client, compra.id_rifa_fk);
                resolve(`Aprovada (<@${compra.id_usuario_fk}>, ${novosNumeros.join(', ')})`);

            } catch (error: any) {
                await new Promise<void>((res, rej) => db.run("ROLLBACK", (err) => err ? rej(err) : res()));
                reject(error);
            }
        });
    });
}

// --- LÓGICA DE REJEIÇÃO (Reutilizável) ---
async function rejeitarCompra(id_compra: number, motivo: string, client: ExtendedClient): Promise<string> {
    return new Promise(async (resolve, reject) => {
        try {
            const compra: Compra = await new Promise((res, rej) => {
                db.get("SELECT * FROM Compras WHERE id_compra = ?", [id_compra], (err, row: Compra) => err ? rej(err) : res(row));
            });

            if (!compra) throw new Error("Compra não encontrada.");
            if (compra.status !== 'em_analise') throw new Error(`Já está com status '${compra.status}'.`);

            await new Promise<void>((res, rej) => {
                db.run("UPDATE Compras SET status = 'rejeitada' WHERE id_compra = ?", [id_compra], (err) => err ? rej(err) : res());
            });

            try {
                const user = await client.users.fetch(compra.id_usuario_fk);
                const dmEmbed = new EmbedBuilder()
                    .setTitle(`❌ Compra Rejeitada (Rifa #${compra.id_rifa_fk})`)
                    .setDescription(`Sua compra (ID: \`${id_compra}\`) de **${compra.quantidade} bilhete(s)** foi rejeitada.`)
                    .addFields({ name: "Motivo da Rejeição", value: motivo })
                    .setColor("Red")
                    .setTimestamp();
                await user.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                console.error("Erro ao enviar DM (rejeitar):", dmError);
            }
            resolve(`Rejeitada (<@${compra.id_usuario_fk}>)`);
        } catch (error: any) {
            reject(error);
        }
    });
}

// --- NOVO HELPER: Buscar todos os IDs pendentes ---
function getPendingCompraIds(): Promise<number[]> {
    return new Promise((resolve, reject) => {
        db.all("SELECT id_compra FROM Compras WHERE status = 'em_analise'", [], (err, rows: {id_compra: number}[]) => {
            if (err) return reject(err);
            resolve(rows.map(r => r.id_compra));
        });
    });
}


// --- EXPORTAÇÃO DO COMANDO ---

export default new Command({
    name: "gestao",
    description: "Gerencia compras e pagamentos.",
    type: ApplicationCommandType.ChatInput,
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,

    options: [
        // ... (opções 'aprovar' e 'rejeitar' individual não mudam) ...
        {
            name: "aprovar",
            description: "Aprova uma compra 'em_analise' e gera os bilhetes.",
            type: ApplicationCommandOptionType.Subcommand,
            options: [{ name: "id_compra", description: "O ID da compra (ex: 1, 2, 3)", type: ApplicationCommandOptionType.Integer, required: true }]
        },
        {
            name: "rejeitar",
            description: "Rejeita uma compra 'em_analise'.",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                { name: "id_compra", description: "O ID da compra a ser rejeitada.", type: ApplicationCommandOptionType.Integer, required: true },
                { name: "motivo", description: "O motivo da rejeição (será enviado ao usuário).", type: ApplicationCommandOptionType.String, required: true }
            ]
        },
        {
            name: "listar",
            description: "Lista todas as compras pendentes (em análise).",
            type: ApplicationCommandOptionType.Subcommand,
        }
    ],

    // Roteador de sub-comandos
    async run({ client, interaction, options }) {

        const subcomando = options.getSubcommand();

        if (subcomando === "aprovar") {
            // ... (lógica 'aprovar' individual não muda) ...
            await interaction.deferReply({ ephemeral: true });
            const id_compra = options.getInteger("id_compra", true);
            try {
                const msg = await aprovarCompra(id_compra, client);
                await interaction.editReply(`✅ Compra #${id_compra} aprovada! Detalhes: ${msg}`);
            } catch (error: any) {
                console.error("[ERRO GESTÃO APROVAR]:", error.message);
                await interaction.editReply(`❌ Erro ao aprovar #${id_compra}: ${error.message}`);
            }
        }
        
        else if (subcomando === "rejeitar") {
            // ... (lógica 'rejeitar' individual não muda) ...
            await interaction.deferReply({ ephemeral: true });
            const id_compra = options.getInteger("id_compra", true);
            const motivo = options.getString("motivo", true);
            try {
                const msg = await rejeitarCompra(id_compra, motivo, client);
                await interaction.editReply(`⛔ Compra #${id_compra} rejeitada. Detalhes: ${msg}`);
            } catch (error: any) {
                console.error("[ERRO GESTÃO REJEITAR]:", error.message);
                await interaction.editReply(`❌ Erro ao rejeitar #${id_compra}: ${error.message}`);
            }
        }
        
        else if (subcomando === "listar") {
            // --- LÓGICA 'LISTAR' ATUALIZADA ---
            await interaction.deferReply({ ephemeral: true });
            try {
                const compras: Compra[] = await new Promise((resolve, reject) => {
                    const sql = `
                        SELECT c.*, u.nome as nome_usuario, r.nome_premio 
                        FROM Compras c
                        JOIN Usuarios u ON c.id_usuario_fk = u.id_discord
                        JOIN Rifas r ON c.id_rifa_fk = r.id_rifa
                        WHERE c.status = 'em_analise'
                        ORDER BY c.data_compra ASC
                    `;
                    db.all(sql, [], (err, rows: Compra[]) => err ? reject(err) : resolve(rows));
                });

                if (compras.length === 0) {
                    return interaction.editReply("Não há nenhuma compra pendente no momento.");
                }

                const embed = new EmbedBuilder()
                    .setTitle(`Compras Pendentes (Total: ${compras.length})`)
                    .setColor("Orange")
                    .setTimestamp();
                
                let description = "";
                compras.forEach((compra: any) => {
                    description += 
                        `**ID: \`${compra.id_compra}\`** - Rifa: \`#${compra.id_rifa_fk}\` (${compra.nome_premio})\n` +
                        `> **Usuário:** ${compra.nome_usuario} (<@${compra.id_usuario_fk}>) | **Qtd:** ${compra.quantidade}\n\n`;
                });

                embed.setDescription(description.substring(0, 4096));

                // Botões de Lote (Existentes)
                const rowLote = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('gestao-aprovar-lote-modal')
                            .setLabel('Aprovar por IDs')
                            .setStyle(ButtonStyle.Success)
                            .setEmoji('✅'),
                        new ButtonBuilder()
                            .setCustomId('gestao-rejeitar-lote-modal')
                            .setLabel('Rejeitar por IDs')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('❌')
                    );
                
                // NOVO: Botões "Todos"
                const rowTodos = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('gestao-aprovar-todos-prompt')
                            .setLabel('Aprovar TODAS Pendentes')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId('gestao-rejeitar-todos-prompt')
                            .setLabel('Rejeitar TODAS Pendentes')
                            .setStyle(ButtonStyle.Danger)
                    );
                
                await interaction.editReply({ embeds: [embed], components: [rowLote, rowTodos] });

            } catch (error: any) {
                console.error("[ERRO GESTÃO LISTAR]:", error.message);
                await interaction.editReply(`❌ Erro ao listar compras: ${error.message}`);
            }
        }
    },

    // --- BOTÕES ATUALIZADOS ---
    buttons: new Collection<string, (interaction: ButtonInteraction, client: ExtendedClient) => any>([
        // Botão: Abre modal para aprovar por IDs (Existente)
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
        
        // Botão: Abre modal para rejeitar por IDs (Existente)
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

        // --- NOVOS BOTÕES DE CONFIRMAÇÃO ---

        // Botão: Pergunta se quer aprovar todos
        ["gestao-aprovar-todos-prompt", async (interaction) => {
            const pendingIds = await getPendingCompraIds();
            if (pendingIds.length === 0) {
                return interaction.reply({ content: "Não há mais compras pendentes para aprovar.", ephemeral: true });
            }
            
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('gestao-aprovar-todos-EXECUTE')
                    .setLabel(`Sim, aprovar TODAS (${pendingIds.length})`)
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('gestao-cancelar-acao')
                    .setLabel('Cancelar')
                    .setStyle(ButtonStyle.Secondary)
            );
            
            await interaction.reply({
                content: `**CONFIRMAÇÃO:** Tem certeza que deseja aprovar **TODAS** as ${pendingIds.length} compras pendentes?`,
                components: [row],
                ephemeral: true
            });
        }],

        // Botão: Pergunta se quer rejeitar todos (e abre modal de motivo)
        ["gestao-rejeitar-todos-prompt", async (interaction) => {
            const pendingIds = await getPendingCompraIds();
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

        // Botão: Cancela a ação (remove a mensagem de confirmação)
        ["gestao-cancelar-acao", (interaction) => {
            interaction.deleteReply();
        }],

        // Botão: EXECUTA a aprovação de todos
        ["gestao-aprovar-todos-EXECUTE", async (interaction, client) => {
            await interaction.deferReply({ ephemeral: true });
            const ids = await getPendingCompraIds();
            
            let successLog = "";
            let errorLog = "";

            for (const id of ids) {
                try {
                    const msg = await aprovarCompra(id, client);
                    successLog += `**ID \`${id}\`:** ${msg}\n`;
                } catch (error: any) {
                    errorLog += `**ID \`${id}\`:** ${error.message}\n`;
                }
            }
            
            const embed = new EmbedBuilder().setTitle("Processamento 'Aprovar Todos' Concluído").setColor("Green").setTimestamp();
            if (successLog) embed.addFields({ name: "✅ Sucessos", value: successLog.substring(0, 1024) });
            if (errorLog) embed.addFields({ name: "❌ Falhas", value: errorLog.substring(0, 1024) });
            
            await interaction.editReply({ embeds: [embed] });
        }]
    ]),

    // --- MODALS ATUALIZADOS ---
    modals: new Collection<string, (interaction: ModalSubmitInteraction, client: ExtendedClient) => any>([
        // Modal: Processa aprovação por IDs (Existente)
        ["gestao-aprovar-lote-submit", async (interaction, client) => {
            await interaction.deferReply({ ephemeral: true });
            const idsString = interaction.fields.getTextInputValue("lote-ids-aprovar");
            const ids = idsString.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

            if (ids.length === 0) return interaction.editReply("Nenhum ID numérico válido foi fornecido.");

            let successLog = "";
            let errorLog = "";
            for (const id of ids) {
                try {
                    const msg = await aprovarCompra(id, client);
                    successLog += `**ID \`${id}\`:** ${msg}\n`;
                } catch (error: any) {
                    errorLog += `**ID \`${id}\`:** ${error.message}\n`;
                }
            }

            const embed = new EmbedBuilder().setTitle("Processamento de Lote (Aprovação) Concluído").setColor("Green").setTimestamp();
            if (successLog) embed.addFields({ name: "✅ Sucessos", value: successLog });
            if (errorLog) embed.addFields({ name: "❌ Falhas", value: errorLog });
            await interaction.editReply({ embeds: [embed] });
        }],

        // Modal: Processa rejeição por IDs (Existente)
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
                    const msg = await rejeitarCompra(id, motivo, client);
                    successLog += `**ID \`${id}\`:** ${msg}\n`;
                } catch (error: any) {
                    errorLog += `**ID \`${id}\`:** ${error.message}\n`;
                }
            }

            const embed = new EmbedBuilder().setTitle("Processamento de Lote (Rejeição) Concluído").setColor("Red").setTimestamp();
            if (successLog) embed.addFields({ name: "✅ Sucessos", value: successLog });
            if (errorLog) embed.addFields({ name: "❌ Falhas", value: errorLog });
            await interaction.editReply({ embeds: [embed] });
        }],

        // NOVO: Modal: Processa rejeição de TODOS
        ["gestao-rejeitar-todos-SUBMIT", async (interaction, client) => {
            await interaction.deferReply({ ephemeral: true });
            const motivo = interaction.fields.getTextInputValue("lote-motivo-todos");
            const ids = await getPendingCompraIds();

            if (!motivo) return interaction.editReply("O motivo é obrigatório.");
            if (ids.length === 0) return interaction.editReply("Não há mais compras para rejeitar.");
            
            let successLog = "";
            let errorLog = "";

            for (const id of ids) {
                try {
                    const msg = await rejeitarCompra(id, motivo, client);
                    successLog += `**ID \`${id}\`:** ${msg}\n`;
                } catch (error: any) {
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