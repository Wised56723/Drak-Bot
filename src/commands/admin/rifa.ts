import { 
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
    EmbedBuilder
} from "discord.js";
import { Command } from "../../structs/types/Command";
import db = require("../../database.js");
import { RunResult } from "sqlite3";
import { ExtendedClient } from "../../structs/ExtendedClient";
import { 
    buildRaffleEmbed, 
    getRifaById,
    buildRaffleWinnerEmbed,
    getAllParticipants,
    Vencedor,
    buildRaffleCancelledEmbed,
    Rifa // NOVO: Importa a interface Rifa
} from "../../utils/RaffleEmbed";

/**
 * Determina o número do bilhete vencedor com base no resultado da loteria
 * e no total de bilhetes da rifa.
 */
function getLotteryWinnerNumber(totalBilhetes: number, numeroSorteado: string): string {
    let requiredLength = String(totalBilhetes - 1).length;
    
    // Pega os últimos N dígitos do número sorteado
    const winnerNumber = numeroSorteado.slice(-requiredLength);
    
    // Garante o padding com zeros à esquerda
    return winnerNumber.padStart(requiredLength, '0');
}

export default new Command({
    name: "rifa",
    description: "Gerencia o sistema de rifas.",
    type: ApplicationCommandType.ChatInput,
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,

    options: [
        {
            name: "criar",
            description: "Abre o formulário para criar uma nova rifa.",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "canal",
                    description: "Canal onde a mensagem da rifa será postada.",
                    type: ApplicationCommandOptionType.Channel,
                    channel_types: [ChannelType.GuildText],
                    required: true
                }
            ]
        },
        {
            name: "sortear",
            description: "Sorteia um vencedor para uma rifa (método Drak).",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "id_rifa",
                    description: "O ID da rifa que será sorteada.",
                    type: ApplicationCommandOptionType.Integer,
                    required: true
                }
            ]
        },
        {
            name: "cancelar",
            description: "Cancela uma rifa ativa e notifica os participantes.",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "id_rifa",
                    description: "O ID da rifa a ser cancelada.",
                    type: ApplicationCommandOptionType.Integer,
                    required: true
                },
                {
                    name: "motivo",
                    description: "O motivo do cancelamento (será enviado aos participantes).",
                    type: ApplicationCommandOptionType.String,
                    required: true
                }
            ]
        },
        // --- NOVO SUB-COMANDO LOTERIA ---
        {
            name: "finalizar-loteria",
            description: "Finaliza uma rifa 'loteria' com o número sorteado.",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "id_rifa",
                    description: "O ID da rifa (método loteria) a ser finalizada.",
                    type: ApplicationCommandOptionType.Integer,
                    required: true
                },
                {
                    name: "numero_sorteado",
                    description: "O número de 5 dígitos sorteado pela Loteria Federal (ex: 12345).",
                    type: ApplicationCommandOptionType.String,
                    required: true
                }
            ]
        }
    ],

    async run({ client, interaction, options }) {

        const subcomando = options.getSubcommand();

        if (subcomando === "criar") {
            // --- LÓGICA DE CRIAR (Existente) ---
            const canal = options.getChannel("canal") as TextChannel;

            if (!canal || !canal.isTextBased()) {
                return interaction.reply({
                    content: "O canal selecionado não é um canal de texto válido.",
                    ephemeral: true
                });
            }

            const modal = new ModalBuilder()
                .setCustomId(`modal-rifa-criar_${canal.id}`)
                .setTitle("Criar Nova Rifa");

            const premioInput = new TextInputBuilder()
                .setCustomId("rifa-premio")
                .setLabel("Nome do Prêmio")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const precoInput = new TextInputBuilder()
                .setCustomId("rifa-preco")
                .setLabel("Preço por Bilhete (ex: 1.50)")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const bilhetesInput = new TextInputBuilder()
                .setCustomId("rifa-bilhetes")
                .setLabel("Total de Bilhetes (ex: 100)")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const metodoInput = new TextInputBuilder()
                .setCustomId("rifa-metodo")
                .setLabel("Método de Sorteio")
                .setPlaceholder("Digite 'drak' ou 'loteria'")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            
            const metaInput = new TextInputBuilder()
                .setCustomId("rifa-meta")
                .setLabel("Meta de Venda % (p/ Loteria)")
                .setPlaceholder("Ex: 75. Deixe em branco se for 'drak'.")
                .setStyle(TextInputStyle.Short)
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(premioInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(precoInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(bilhetesInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(metodoInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(metaInput)
            );

            await interaction.showModal(modal);
        }
        
        else if (subcomando === "sortear") {
            // --- LÓGICA DE SORTEAR (Existente) ---
            await interaction.deferReply({ ephemeral: true });
            
            const id_rifa = options.getInteger("id_rifa", true);

            try {
                const rifa: Rifa | null = await getRifaById(id_rifa);
                
                if (!rifa) throw new Error("Rifa não encontrada.");
                if (rifa.status !== 'ativa') throw new Error("Esta rifa não está ativa.");
                if (rifa.metodo_sorteio !== 'drak') {
                    throw new Error("Esta rifa não usa o método de sorteio 'drak'.");
                }

                const sqlVencedor = `
                    SELECT 
                        b.numero_bilhete, 
                        u.id_discord, 
                        u.nome 
                    FROM Bilhetes b
                    JOIN Compras c ON b.id_compra_fk = c.id_compra
                    JOIN Usuarios u ON c.id_usuario_fk = u.id_discord
                    WHERE c.id_rifa_fk = ? AND c.status = 'aprovada'
                    ORDER BY RANDOM()
                    LIMIT 1
                `;
                
                const vencedor: Vencedor = await new Promise((resolve, reject) => {
                    db.get(sqlVencedor, [id_rifa], (err, row: Vencedor) => err ? reject(err) : resolve(row));
                });

                if (!vencedor) {
                    throw new Error("Nenhum bilhete 'aprovado' foi encontrado nesta rifa para sortear.");
                }

                await new Promise<void>((resolve, reject) => {
                    db.run("UPDATE Rifas SET status = 'finalizada' WHERE id_rifa = ?", 
                        [id_rifa], 
                        (err) => err ? reject(err) : resolve()
                    );
                });

                if (rifa.channel_id && rifa.message_id) {
                    try {
                        const channel = await client.channels.fetch(rifa.channel_id) as TextChannel;
                        const message = await channel.messages.fetch(rifa.message_id);
                        
                        const winnerEmbed = buildRaffleWinnerEmbed(rifa, vencedor);
                        await message.edit({ embeds: [winnerEmbed], components: [] }); 
                    } catch (msgError) {
                        console.error("Erro ao atualizar msg pública:", msgError);
                    }
                }

                const participants = await getAllParticipants(id_rifa);
                for (const userId of participants) {
                    try {
                        const user = await client.users.fetch(userId);
                        
                        if (userId === vencedor.id_discord) {
                            const embed = new EmbedBuilder()
                                .setTitle(`🎉 Parabéns! Você Ganhou!`)
                                .setDescription(`Você foi o grande vencedor da **Rifa #${id_rifa}: ${rifa.nome_premio}**!`)
                                .addFields({ name: "Seu Bilhete Sorteado", value: `\`\`\`${vencedor.numero_bilhete}\`\`\`` })
                                .setColor("Gold")
                                .setTimestamp();
                            await user.send({ embeds: [embed] });
                        
                        } else {
                            const embed = new EmbedBuilder()
                                .setTitle(`Sorteio Realizado - Rifa #${id_rifa}: ${rifa.nome_premio}`)
                                .setDescription(
                                    `O sorteio da rifa **${rifa.nome_premio}** foi finalizado.\n\n` +
                                    `O vencedor foi **${vencedor.nome}** (<@${vencedor.id_discord}>) ` +
                                    `com o bilhete \`${vencedor.numero_bilhete}\`.\n\n` +
                                    `Obrigado por participar!`
                                )
                                .setColor("Grey")
                                .setTimestamp();
                            await user.send({ embeds: [embed] });
                        }
                    } catch (dmError) {
                        console.error(`Erro ao enviar DM para ${userId}:`, dmError);
                    }
                }

                await interaction.editReply(
                    `🎉 Sorteio Realizado com Sucesso!\n\n` +
                    `**Rifa:** ${rifa.nome_premio}\n` +
                    `**Vencedor:** ${vencedor.nome} (<@${vencedor.id_discord}>)\n` +
                    `**Bilhete:** \`${vencedor.numero_bilhete}\`\n\n` +
                    `O vencedor e todos os participantes foram notificados por DM.`
                );

            } catch (error: any) {
                console.error("[ERRO RIFA SORTEAR]:", error.message);
                await interaction.editReply(`❌ Erro ao sortear: ${error.message}`);
            }
        }

        else if (subcomando === "cancelar") {
            // --- LÓGICA DE CANCELAR (Existente) ---
            await interaction.deferReply({ ephemeral: true });

            const id_rifa = options.getInteger("id_rifa", true);
            const motivo = options.getString("motivo", true);

            try {
                const rifa: Rifa | null = await getRifaById(id_rifa);
                if (!rifa) {
                    throw new Error("Rifa não encontrada.");
                }
                if (rifa.status !== 'ativa') {
                    throw new Error(`Esta rifa não pode ser cancelada (Status atual: '${rifa.status}').`);
                }

                await new Promise<void>((resolve, reject) => {
                    db.run("UPDATE Rifas SET status = 'cancelada' WHERE id_rifa = ?", 
                        [id_rifa], 
                        (err) => err ? reject(err) : resolve()
                    );
                });

                if (rifa.channel_id && rifa.message_id) {
                    try {
                        const channel = await client.channels.fetch(rifa.channel_id) as TextChannel;
                        const message = await channel.messages.fetch(rifa.message_id);
                        
                        const cancelledEmbed = buildRaffleCancelledEmbed(rifa, motivo);
                        await message.edit({ embeds: [cancelledEmbed], components: [] }); 
                    } catch (msgError) {
                        console.error("Erro ao atualizar msg pública (cancelar):", msgError);
                    }
                }

                const participants = await getAllParticipants(id_rifa);
                if (participants.length > 0) {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle(`❌ Rifa Cancelada - #${rifa.id_rifa}: ${rifa.nome_premio}`)
                        .setDescription("Infelizmente, a rifa da qual você estava participando foi cancelada.")
                        .addFields(
                            { name: "Motivo", value: motivo },
                            { name: "Reembolso", value: "Por favor, entre em contato com um administrador para solicitar o reembolso do seu pagamento." }
                        )
                        .setColor("Red")
                        .setTimestamp();
                    
                    for (const userId of participants) {
                        try {
                            const user = await client.users.fetch(userId);
                            await user.send({ embeds: [dmEmbed] });
                        } catch (dmError) {
                            console.error(`Erro ao enviar DM de cancelamento para ${userId}:`, dmError);
                        }
                    }
                }
                
                const participantMentions = participants.length > 0 
                    ? participants.map(id => `<@${id}>`).join(', ') 
                    : "Nenhum";

                await interaction.editReply(
                    `🗑️ Rifa #${id_rifa} cancelada com sucesso.\n` +
                    `**Motivo:** ${motivo}\n` +
                    `**Usuários a reembolsar:** ${participantMentions}`
                );

            } catch (error: any) {
                console.error("[ERRO RIFA CANCELAR]:", error.message);
                await interaction.editReply(`❌ Erro ao cancelar: ${error.message}`);
            }
        }
        
        // --- NOVA LÓGICA DE FINALIZAR-LOTERIA ---
        else if (subcomando === "finalizar-loteria") {
            await interaction.deferReply({ ephemeral: true });

            const id_rifa = options.getInteger("id_rifa", true);
            const numero_sorteado_input = options.getString("numero_sorteado", true);

            // Valida o input (deve ser numérico)
            if (!/^\d+$/.test(numero_sorteado_input)) {
                return interaction.editReply("O número sorteado deve conter apenas dígitos.");
            }

            try {
                // 1. Validar a Rifa
                const rifa: Rifa | null = await getRifaById(id_rifa);
                if (!rifa) {
                    throw new Error("Rifa não encontrada.");
                }
                if (rifa.metodo_sorteio !== 'loteria') {
                    throw new Error("Esta rifa não é do método 'loteria'.");
                }
                if (rifa.status !== 'aguardando_sorteio') {
                    throw new Error(`Esta rifa não está 'aguardando_sorteio' (Status: ${rifa.status}).`);
                }

                // 2. Determinar o número vencedor
                const bilheteVencedorStr = getLotteryWinnerNumber(rifa.total_bilhetes, numero_sorteado_input);

                // 3. Buscar o Vencedor no DB
                const sqlVencedor = `
                    SELECT 
                        b.numero_bilhete, 
                        u.id_discord, 
                        u.nome 
                    FROM Bilhetes b
                    JOIN Compras c ON b.id_compra_fk = c.id_compra
                    JOIN Usuarios u ON c.id_usuario_fk = u.id_discord
                    WHERE c.id_rifa_fk = ? AND c.status = 'aprovada' AND b.numero_bilhete = ?
                `;
                
                const vencedor: Vencedor = await new Promise((resolve, reject) => {
                    db.get(sqlVencedor, [id_rifa, bilheteVencedorStr], (err, row: Vencedor) => err ? reject(err) : resolve(row));
                });

                // 4. Se NINGUÉM ganhou (bilhete não foi vendido)
                if (!vencedor) {
                    // TODO: Implementar regra de "aproximação" ou "próximo prêmio"
                    // Por agora, apenas finaliza sem vencedor.
                    await new Promise<void>((resolve, reject) => {
                        db.run("UPDATE Rifas SET status = 'finalizada' WHERE id_rifa = ?", 
                            [id_rifa], 
                            (err) => err ? reject(err) : resolve()
                        );
                    });
                    
                    await interaction.editReply(
                        `ℹ️ Sorteio da Loteria Registrado!\n` +
                        `**Número Sorteado:** ${numero_sorteado_input}\n` +
                        `**Bilhete Vencedor (calculado):** \`${bilheteVencedorStr}\`\n\n` +
                        `**NINGUÉM COMPROU ESTE BILHETE.** A rifa foi finalizada sem vencedores.`
                    );
                    
                    // (Poderia atualizar a msg pública aqui também)
                    return; 
                }

                // 5. Se TEMOS UM VENCEDOR
                await new Promise<void>((resolve, reject) => {
                    db.run("UPDATE Rifas SET status = 'finalizada' WHERE id_rifa = ?", 
                        [id_rifa], 
                        (err) => err ? reject(err) : resolve()
                    );
                });

                // 6. Atualizar Mensagem Pública
                if (rifa.channel_id && rifa.message_id) {
                    try {
                        const channel = await client.channels.fetch(rifa.channel_id) as TextChannel;
                        const message = await channel.messages.fetch(rifa.message_id);
                        const winnerEmbed = buildRaffleWinnerEmbed(rifa, vencedor);
                        await message.edit({ embeds: [winnerEmbed], components: [] }); 
                    } catch (msgError) {
                        console.error("Erro ao atualizar msg pública:", msgError);
                    }
                }

                // 7. Notificar todos os participantes
                const participants = await getAllParticipants(id_rifa);
                for (const userId of participants) {
                    try {
                        const user = await client.users.fetch(userId);
                        
                        if (userId === vencedor.id_discord) {
                            const embed = new EmbedBuilder()
                                .setTitle(`🎉 Parabéns! Você Ganhou!`)
                                .setDescription(`Você foi o grande vencedor da **Rifa #${id_rifa}: ${rifa.nome_premio}**!`)
                                .addFields({ name: "Seu Bilhete Sorteado", value: `\`\`\`${vencedor.numero_bilhete}\`\`\`` })
                                .setFooter({ text: `Resultado da Loteria: ${numero_sorteado_input}`})
                                .setColor("Gold")
                                .setTimestamp();
                            await user.send({ embeds: [embed] });
                        
                        } else {
                            const embed = new EmbedBuilder()
                                .setTitle(`Sorteio Realizado - Rifa #${id_rifa}: ${rifa.nome_premio}`)
                                .setDescription(
                                    `O sorteio da rifa **${rifa.nome_premio}** foi finalizado.\n\n` +
                                    `O vencedor foi **${vencedor.nome}** (<@${vencedor.id_discord}>) ` +
                                    `com o bilhete \`${vencedor.numero_bilhete}\`.\n\n` +
                                    `Obrigado por participar!`
                                )
                                .setFooter({ text: `Resultado da Loteria: ${numero_sorteado_input}`})
                                .setColor("Grey")
                                .setTimestamp();
                            await user.send({ embeds: [embed] });
                        }
                    } catch (dmError) {
                        console.error(`Erro ao enviar DM para ${userId}:`, dmError);
                    }
                }

                // 8. Responder ao Admin
                await interaction.editReply(
                    `🎉 Sorteio da Loteria Finalizado com Sucesso!\n\n` +
                    `**Rifa:** ${rifa.nome_premio}\n` +
                    `**Número da Loteria:** ${numero_sorteado_input}\n` +
                    `**Bilhete Vencedor (calculado):** \`${bilheteVencedorStr}\`\n\n` +
                    `**Vencedor:** ${vencedor.nome} (<@${vencedor.id_discord}>)\n\n` +
                    `O vencedor e todos os participantes foram notificados.`
                );

            } catch (error: any) {
                console.error("[ERRO RIFA FINALIZAR-LOTERIA]:", error.message);
                await interaction.editReply(`❌ Erro ao finalizar: ${error.message}`);
            }
        }
    },

    // --- MODAL HANDLER (Existente) ---
    modals: new Collection<string, (interaction: ModalSubmitInteraction, client: ExtendedClient) => any>([
        ["modal-rifa-criar_", async (interaction, client) => {
            
            if (!interaction.inGuild()) return; 
            
            await interaction.deferReply({ ephemeral: true });

            const [, channelId] = interaction.customId.split('_');
            const channel = await client.channels.fetch(channelId) as TextChannel;

            if (!channel || !channel.isTextBased()) {
                return interaction.editReply("Erro: Canal não encontrado ou inválido.");
            }

            const nome_premio = interaction.fields.getTextInputValue("rifa-premio");
            const preco_bilhete_input = interaction.fields.getTextInputValue("rifa-preco").replace(',', '.');
            const total_bilhetes_input = interaction.fields.getTextInputValue("rifa-bilhetes");
            const metodo_sorteio_input = interaction.fields.getTextInputValue("rifa-metodo").toLowerCase();
            const meta_completude_input = interaction.fields.getTextInputValue("rifa-meta");

            const preco_bilhete = parseFloat(preco_bilhete_input);
            if (isNaN(preco_bilhete) || preco_bilhete <= 0) {
                return interaction.editReply("O preço deve ser um número positivo (ex: 1.50).");
            }

            const total_bilhetes = parseInt(total_bilhetes_input);
            if (isNaN(total_bilhetes) || total_bilhetes <= 0) {
                return interaction.editReply("O total de bilhetes deve ser um número positivo.");
            }
            if (metodo_sorteio_input !== 'drak' && metodo_sorteio_input !== 'loteria') {
                return interaction.editReply("Método de sorteio inválido. Use 'drak' ou 'loteria'.");
            }
            let meta_completude: number | null = null;
            if (metodo_sorteio_input === 'loteria') {
                if (!meta_completude_input) {
                    return interaction.editReply("Para sorteio 'loteria', a 'Meta de Venda' é obrigatória.");
                }
                meta_completude = parseFloat(meta_completude_input);
                if (isNaN(meta_completude) || meta_completude < 1 || meta_completude > 100) {
                    return interaction.editReply("A meta de venda deve ser um número entre 1 e 100.");
                }
                meta_completude = meta_completude / 100.0;
            }

            // MODIFICADO: Inclui 'sorteio_data' como NULL
            const sqlInsert = `INSERT INTO Rifas (nome_premio, total_bilhetes, status, metodo_sorteio, meta_completude, preco_bilhete, sorteio_data) 
                         VALUES (?, ?, 'ativa', ?, ?, ?, NULL)`;
            const paramsInsert = [nome_premio, total_bilhetes, metodo_sorteio_input, meta_completude, preco_bilhete];

            try {
                const newRifaId = await new Promise<number>((resolve, reject) => {
                    db.run(sqlInsert, paramsInsert, function(this: RunResult, err: Error | null) {
                        if (err) return reject(err);
                        resolve(this.lastID);
                    });
                });

                const rifaObjeto: Rifa = {
                    id_rifa: newRifaId,
                    nome_premio: nome_premio,
                    total_bilhetes: total_bilhetes,
                    status: 'ativa',
                    metodo_sorteio: metodo_sorteio_input,
                    meta_completude: meta_completude,
                    channel_id: channel.id,
                    message_id: '',
                    preco_bilhete: preco_bilhete,
                    sorteio_data: null
                };
                
                const embed = buildRaffleEmbed(rifaObjeto, 0); 

                const raffleMessage = await channel.send({ embeds: [embed] });

                const sqlUpdate = `UPDATE Rifas SET channel_id = ?, message_id = ? WHERE id_rifa = ?`;
                await new Promise<void>((resolve, reject) => {
                    db.run(sqlUpdate, [channel.id, raffleMessage.id, newRifaId], (err) => {
                        if (err) return reject(err);
                        resolve();
                    });
                });

                await interaction.editReply(
                    `🎉 Rifa criada com sucesso! \n` +
                    `A mensagem de acompanhamento foi postada em ${channel}.`
                );

            } catch (err: any) {
                console.error("Erro ao criar rifa:", err);
                await interaction.editReply('Ocorreu um erro ao tentar criar a rifa. 😢');
            }
        }]
    ])
});