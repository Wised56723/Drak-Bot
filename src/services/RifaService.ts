// src/services/RifaService.ts

import { 
    ModalSubmitInteraction, 
    TextChannel, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ChatInputCommandInteraction
} from "discord.js";
import { ExtendedClient } from "../structs/ExtendedClient";
import { prisma } from "../prismaClient";
import { 
    buildRaffleEmbed, 
    getRifaById, 
    buildRaffleWinnerEmbed, 
    getAllParticipants, 
    Vencedor, 
    buildRaffleCancelledEmbed, 
    Rifa, 
    Premios, 
    countBilhetesReservados 
} from "../utils/RaffleEmbed";
import { Logger, LogContext } from "../utils/Logger";
// --- REMOVIDO: import { config } from ".."; ---
import { PIX } from "gpix/dist";

const CONTEXT: LogContext = "RifaService";

// ... (Função 'criarRifa' é longa, assumindo que você irá atualizar a lógica de PIX/IDs nela também, 
//      mas para brevidade, apenas focamos em processarCompraRifa) ...
export async function criarRifa(interaction: ModalSubmitInteraction, client: ExtendedClient) {
    if (!interaction.inGuild()) return; 
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const [, channelId] = interaction.customId.split('_');
        const channel = await client.channels.fetch(channelId) as TextChannel;
        // ... (resto da lógica de criação, parsing de prêmios e transação) ...
        // Nota: Você deve verificar se o preço é válido antes de prosseguir

        // Parse basic fields from modal (form inputs from the admin UI)
        const nome_premio = interaction.fields.getTextInputValue("rifa-premio");
        const precoInput = interaction.fields.getTextInputValue("rifa-preco");
        const bilhetesInput = interaction.fields.getTextInputValue("rifa-bilhetes");
        const metodoInput = interaction.fields.getTextInputValue("rifa-metodo");
        const premiosSecundarios = interaction.fields.getTextInputValue("premios-secundarios") || "";

        const precoParsed = parseFloat(precoInput.replace(',', '.'));
        const totalBilhetes = parseInt(bilhetesInput);

        if (!nome_premio || isNaN(precoParsed) || isNaN(totalBilhetes) || totalBilhetes <= 0 || precoParsed <= 0) {
            return interaction.editReply("Dados inválidos no formulário. Verifique o prêmio, preço e total de bilhetes.");
        }

        const metodo_sorteio = metodoInput && metodoInput.toLowerCase().startsWith("loteria") ? "loteria" : "drak";

        // Create the rifa in the database
        const newRifa = await prisma.rifa.create({
            data: {
                nome_premio: nome_premio,
                total_bilhetes: totalBilhetes,
                preco_bilhete: precoParsed,
                metodo_sorteio: metodo_sorteio,
                status: 'ativa',
                top_compradores_count: 0,
                top_compradores_premios: premiosSecundarios || null
            }
        });

        const messageData = await buildRaffleEmbed(newRifa, 0); 
        const raffleMessage = await channel.send(messageData);

        await prisma.rifa.update({
            where: { id_rifa: newRifa.id_rifa },
            data: { channel_id: channel.id, message_id: raffleMessage.id }
        });

        Logger.info(CONTEXT, `Rifa #${newRifa.id_rifa} criada com sucesso.`);
        await interaction.editReply(
            `🎉 Rifa criada com sucesso! \n` +
            `(Prémios Top e Bilhetes Secretos foram configurados).\n` +
            `A mensagem de acompanhamento foi postada em ${channel}.`
        );
    } catch (err: any) {
        Logger.error(CONTEXT, "Erro ao criar rifa (modal-rifa-criar_)", err);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Ocorreu um erro ao tentar criar a rifa. 😢', ephemeral: true });
        } else {
            try {
                await interaction.editReply('Ocorreu um erro ao tentar criar a rifa. 😢');
            } catch { /* ignore */ }
        }
    }
}


/**
 * Lógica de negócio para PROCESSAR COMPRA de uma rifa.
 */
export async function processarCompraRifa(interaction: ModalSubmitInteraction, client: ExtendedClient) {
    
    await interaction.deferReply({ ephemeral: true });

    const [, rifaIdStr] = interaction.customId.split('_');
    const id_rifa = parseInt(rifaIdStr);
    const id_discord = interaction.user.id;
    const quantidade_input = interaction.fields.getTextInputValue("buy-modal-quantidade");
    const quantidade = parseInt(quantidade_input);
    const referral_code_input = interaction.fields.getTextInputValue("referral-code")?.toUpperCase() || null;

    if (isNaN(id_rifa)) {
        Logger.warn(CONTEXT, `ID de rifa inválido no modal 'buy-modal_': ${rifaIdStr}`);
        return interaction.editReply("Erro: ID da rifa inválido.");
    }
    if (isNaN(quantidade) || quantidade <= 0) {
        return interaction.editReply("A quantidade deve ser um número positivo.");
    }

    try {
        const usuario = await prisma.usuario.findUnique({ where: { id_discord: id_discord } });
        if (!usuario) {
            return interaction.editReply("Você não está registado! Use o botão de registo no canal de boas-vindas primeiro.");
        }

        let id_indicador: string | null = null;
        if (referral_code_input) {
            if (usuario.referral_code === referral_code_input) {
                return interaction.editReply("Você não pode usar o seu próprio código de indicador!");
            }
            const indicador = await prisma.usuario.findUnique({
                where: { referral_code: referral_code_input }
            });
            if (!indicador) {
                return interaction.editReply("Esse código de indicador não foi encontrado.");
            }
            id_indicador = indicador.id_discord;
        }

        const rifa = await prisma.rifa.findUnique({ where: { id_rifa: id_rifa } });
        if (!rifa) {
             Logger.warn(CONTEXT, `Rifa #${id_rifa} não encontrada (processarCompraRifa)`);
             return interaction.editReply("Erro: Rifa não encontrada.");
        }
        if (rifa.status !== 'ativa' && rifa.status !== 'aguardando_sorteio') {
            return interaction.editReply(`A rifa "${rifa.nome_premio}" não está aceitando compras.`);
        }

        const reservados = await countBilhetesReservados(id_rifa);
        const disponiveis = rifa.total_bilhetes - reservados;
        if (quantidade > disponiveis) {
            return interaction.editReply(`Bilhetes insuficientes. Tentou comprar: **${quantidade}** / Disponíveis: **${disponiveis}**`);
        }

        Logger.info(CONTEXT, `Processando compra: Rifa #${id_rifa}, User: ${id_discord}, Qtd: ${quantidade}, Indicador: ${id_indicador || 'Nenhum'}`);

        const newCompra = await prisma.compras.create({
            data: {
                id_rifa_fk: id_rifa,
                id_usuario_fk: id_discord,
                data_compra: new Date(),
                quantidade: quantidade,
                status: 'em_analise',
                id_indicador_fk: id_indicador
            }
        });
        const newCompraId = newCompra.id_compra;

        const totalPreco = (quantidade * rifa.preco_bilhete);
        const totalPrecoString = totalPreco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        let pixCode = "";
        
        // --- CORREÇÃO AQUI: Lógica PIX usa process.env ---
        try {
            const safeTxid = String(newCompraId).replace(/[^a-zA-Z0-9]/g, "").substring(0, 25);
            // Lê de process.env
            const pix = PIX.static()
                           .setReceiverName(process.env.PIX_MERCHANT_NAME)
                           .setReceiverCity(process.env.PIX_MERCHANT_CITY)
                           .setKey(process.env.PIX_KEY)
                           .setAmount(totalPreco)
                           .setIdentificator(safeTxid); 
            pixCode = pix.getBRCode();
        } catch (pixError: any) {
            Logger.error(CONTEXT, "Erro ao gerar BRCode do PIX", pixError); 
            pixCode = "Erro ao gerar código. Use a chave manual.";
        }
        // --- FIM DA CORREÇÃO ---

        const dmEmbed = new EmbedBuilder()
            .setTitle("✅ Reserva de Bilhetes Realizada!")
            .setDescription(`Sua reserva para a rifa **${rifa.nome_premio}** foi registrada.\n**ID da sua Compra:** \`${newCompraId}\`\n\nPara confirmar, pague o valor abaixo:`)
            .addFields(
                { name: "Valor Total", value: `**${totalPrecoString}**`, inline: false },
                { name: "Pix Copia e Cola (com valor e ID)", value: pixCode, inline: false }
            )
            .setColor("Blue")
            .setFooter({ text: "Após o pagamento, um admin irá aprovar sua compra." });
            
        try {
            const userDM = await interaction.user.createDM();
            await userDM.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            Logger.error(CONTEXT, `Erro ao enviar DM de compra para ${id_discord}`, dmError);
            return interaction.editReply("Falha ao enviar a DM com o Pix. Verifique se suas DMs estão abertas.");
        }

        try {
            // --- CORREÇÃO AQUI: Log Channel ID usa process.env ---
            const logChannelId = process.env.LOG_CHANNEL_ID;
            if (!logChannelId) throw new Error("LOG_CHANNEL_ID não definida.");
            const logChannel = await client.channels.fetch(logChannelId) as TextChannel;
            // --- FIM DA CORREÇÃO ---
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle("🔔 Nova Compra Pendente")
                    .setDescription(`Utilizador: <@${id_discord}> (${usuario.nome})\nRifa: #${id_rifa} (${rifa.nome_premio})`)
                    .addFields(
                        { name: "ID da Compra", value: `\`${newCompraId}\``, inline: true },
                        { name: "Quantidade", value: `${quantidade}`, inline: true },
                        { name: "Valor", value: totalPrecoString, inline: true }
                    )
                    .setColor("Orange").setTimestamp();
                const actionRow = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder().setCustomId(`log-approve_${newCompraId}`).setLabel("Aprovar").setStyle(ButtonStyle.Success).setEmoji("✅"),
                        new ButtonBuilder().setCustomId(`log-reject_${newCompraId}`).setLabel("Rejeitar").setStyle(ButtonStyle.Danger).setEmoji("❌")
                    );
                await logChannel.send({ content: `Ação necessária para a Compra #${newCompraId}:`, embeds: [logEmbed], components: [actionRow] });
            }
        } catch (logErr) { 
            Logger.error(CONTEXT, `Erro ao enviar log de compra`, logErr);
        }

        await interaction.editReply("✅ **Sucesso!** Enviei os detalhes do pagamento e o Pix Copia e Cola para a sua DM.");
    } catch (error: any) {
        Logger.error(CONTEXT, `Erro no fluxo de compra (buy-modal_ ID: ${id_rifa})`, error);
        await interaction.editReply("Ocorreu um erro inesperado ao processar sua compra. 😢");
    }
}


// ... (As outras funções não mudam) ...
export async function sortearRifaDrak(id_rifa: number, client: ExtendedClient, interaction: ChatInputCommandInteraction) { /* ... */ }
export async function cancelarRifa(id_rifa: number, motivo: string, client: ExtendedClient, interaction: ChatInputCommandInteraction) { /* ... */ }
export async function finalizarRifaLoteria(id_rifa: number, numero_sorteado_input: string, client: ExtendedClient, interaction: ChatInputCommandInteraction) { /* ... */ }