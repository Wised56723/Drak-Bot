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
import { config } from "..";
import { PIX } from "gpix/dist";

const CONTEXT: LogContext = "RifaService";

// ... (A função 'criarRifa' não muda) ...
export async function criarRifa(interaction: ModalSubmitInteraction, client: ExtendedClient) {
    if (!interaction.inGuild()) return; 
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
        const [, channelId] = interaction.customId.split('_');
        const channel = await client.channels.fetch(channelId) as TextChannel;
        if (!channel || !channel.isTextBased()) {
            return interaction.editReply("Erro: Canal não encontrado ou inválido.");
        }

        const nome_premio = interaction.fields.getTextInputValue("rifa-premio");
        const preco_bilhete_input = interaction.fields.getTextInputValue("rifa-preco").replace(',', '.');
        const total_bilhetes_input = interaction.fields.getTextInputValue("rifa-bilhetes");
        const metodo_input_raw = interaction.fields.getTextInputValue("rifa-metodo").toLowerCase();
        const premios_secundarios_input = interaction.fields.getTextInputValue("premios-secundarios");
        
        const preco_bilhete = parseFloat(preco_bilhete_input);
        if (isNaN(preco_bilhete) || preco_bilhete <= 0) {
            return interaction.editReply("O preço deve ser um número positivo (ex: 1.50).");
        }
        const total_bilhetes = parseInt(total_bilhetes_input);
        if (isNaN(total_bilhetes) || total_bilhetes <= 0) {
            return interaction.editReply("O total de bilhetes deve ser um número positivo.");
        }
        
        let metodo_sorteio = 'drak';
        let meta_completude: number | null = null;
        if (metodo_input_raw.startsWith('loteria')) {
            metodo_sorteio = 'loteria';
            const parts = metodo_input_raw.split(':');
            if (parts.length < 2) return interaction.editReply("Formato inválido. Use 'loteria:75' (para 75% de meta).");
            meta_completude = parseFloat(parts[1]);
            if (isNaN(meta_completude) || meta_completude < 1 || meta_completude > 100) {
                return interaction.editReply("A meta da loteria deve ser um número entre 1 e 100.");
            }
            meta_completude = meta_completude / 100.0;
        } else if (metodo_input_raw !== 'drak') {
            return interaction.editReply("Método inválido. Use 'drak' ou 'loteria:META'.");
        }

        let top_compradores_count = 0;
        const premiosJSON: Premios = {};
        const premiosBilhete: { qtd: number, desc: string }[] = [];
        if (premios_secundarios_input) {
            const lines = premios_secundarios_input.split('\n').filter(line => line.trim().length > 0);
            for (const line of lines) {
                const parts = line.split(':');
                if (parts.length < 2) return interaction.editReply(`Formato inválido nos Prémios. Use 'TIPO: ...'. Linha: "${line}"`);
                const tipo = parts[0].trim().toUpperCase();
                const desc = parts.slice(1).join(':').trim();
                if (tipo.startsWith('TOP')) {
                    const pos = tipo.replace('TOP', '').trim();
                    if (pos !== '1' && pos !== '2' && pos !== '3') return interaction.editReply(`Prémio TOP inválido. Use 'TOP 1', 'TOP 2' ou 'TOP 3'. (Erro: ${tipo})`);
                    premiosJSON[pos] = desc;
                } 
                else if (tipo.startsWith('BILHETE')) {
                    const qtdMatch = tipo.match(/(\d+)X/);
                    const qtd = qtdMatch ? parseInt(qtdMatch[1]) : 1;
                    if (isNaN(qtd) || qtd <= 0) return interaction.editReply(`Quantidade de Bilhete Prémio inválida. (Erro: ${tipo})`);
                    if (qtd > 5) return interaction.editReply("Não pode definir mais de 5 bilhetes premiados do mesmo tipo.");
                    premiosBilhete.push({ qtd: qtd, desc: desc });
                }
                else {
                    return interaction.editReply(`Tipo de Prémio inválido. Use 'TOP' ou 'BILHETE'. (Erro: ${tipo})`);
                }
            }
            top_compradores_count = Object.keys(premiosJSON).length;
        }
        const top_compradores_premios_db = top_compradores_count > 0 ? JSON.stringify(premiosJSON) : null;

        Logger.info(CONTEXT, `Tentando criar rifa '${nome_premio}' no canal ${channel.id}`);

        const newRifa = await prisma.$transaction(async (tx) => {
            const rifaCriada = await tx.rifa.create({
                data: {
                    nome_premio: nome_premio, total_bilhetes: total_bilhetes, status: 'ativa',
                    metodo_sorteio: metodo_sorteio, meta_completude: meta_completude,
                    preco_bilhete: preco_bilhete, top_compradores_count: top_compradores_count,
                    top_compradores_premios: top_compradores_premios_db, sorteio_data: null
                }
            });
            if (premiosBilhete.length > 0) {
                const padding = String(total_bilhetes - 1).length;
                const bilhetesSecretosGerados = new Set<string>();
                for (const premio of premiosBilhete) {
                    let count = 0;
                    while(count < premio.qtd) {
                        const numeroAleatorio = Math.floor(Math.random() * total_bilhetes);
                        const numeroFormatado = String(numeroAleatorio).padStart(padding, '0');
                        if (!bilhetesSecretosGerados.has(numeroFormatado)) {
                            bilhetesSecretosGerados.add(numeroFormatado);
                            count++;
                            await tx.premiosInstantaneos.create({
                                data: {
                                    id_rifa_fk: rifaCriada.id_rifa,
                                    numero_bilhete: numeroFormatado,
                                    descricao_premio: premio.desc
                                }
                            });
                        }
                    }
                }
            }
            return rifaCriada;
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
            await interaction.editReply('Ocorreu um erro ao tentar criar a rifa. 😢');
        }
    }
}

/**
 * Lógica de negócio para PROCESSAR COMPRA de uma rifa.
 * (Movido do modal 'buy-modal_')
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
        try {
            const safeTxid = String(newCompraId).replace(/[^a-zA-Z0-9]/g, "").substring(0, 25);
            const pix = PIX.static().setReceiverName(config.pixMerchantName).setReceiverCity(config.pixMerchantCity).setKey(config.pixKey).setAmount(totalPreco).setIdentificator(safeTxid); 
            pixCode = pix.getBRCode();
        } catch (pixError: any) {
            Logger.error(CONTEXT, "Erro ao gerar BRCode do PIX", pixError); 
            pixCode = "Erro ao gerar código. Use a chave manual.";
        }

        // --- CORREÇÃO AQUI ---
        // O campo "Chave Pix Manual" foi removido.
        const dmEmbed = new EmbedBuilder()
            .setTitle("✅ Reserva de Bilhetes Realizada!")
            .setDescription(`Sua reserva para a rifa **${rifa.nome_premio}** foi registrada.\n**ID da sua Compra:** \`${newCompraId}\`\n\nPara confirmar, pague o valor abaixo:`)
            .addFields(
                { name: "Valor Total", value: `**${totalPrecoString}**`, inline: false },
                { name: "Pix Copia e Cola (com valor e ID)", value: pixCode, inline: false }
            )
            .setColor("Blue")
            .setFooter({ text: "Após o pagamento, um admin irá aprovar sua compra." });
        // --- FIM DA CORREÇÃO ---
            
        try {
            const userDM = await interaction.user.createDM();
            await userDM.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            Logger.error(CONTEXT, `Erro ao enviar DM de compra para ${id_discord}`, dmError);
            return interaction.editReply("Falha ao enviar a DM com o Pix. Verifique se suas DMs estão abertas.");
        }

        try {
            const logChannel = await client.channels.fetch(config.logChannelId) as TextChannel;
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
            Logger.error(CONTEXT, `Erro ao enviar log de compra para o canal ${config.logChannelId}`, logErr);
        }

        await interaction.editReply("✅ **Sucesso!** Enviei os detalhes do pagamento e o Pix Copia e Cola para a sua DM.");
    } catch (error: any) {
        Logger.error(CONTEXT, `Erro no fluxo de compra (buy-modal_ ID: ${id_rifa})`, error);
        await interaction.editReply("Ocorreu um erro inesperado ao processar sua compra. 😢");
    }
}


// ... (A função 'sortearRifaDrak' não muda) ...
export async function sortearRifaDrak(id_rifa: number, client: ExtendedClient, interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        Logger.info(CONTEXT, `Tentando sortear (drak) rifa #${id_rifa}`);
        const rifa: Rifa | null = await getRifaById(id_rifa);
        if (!rifa) throw new Error("Rifa não encontrada.");
        if (rifa.status !== 'ativa') throw new Error("Esta rifa não está ativa.");
        if (rifa.metodo_sorteio !== 'drak') throw new Error("Esta rifa não usa o método de sorteio 'drak'.");

        const totalBilhetesVendidos = await prisma.bilhetes.count({
            where: { compra: { id_rifa_fk: id_rifa, status: 'aprovada' } }
        });
        if (totalBilhetesVendidos === 0) {
            throw new Error("Nenhum bilhete 'aprovado' foi encontrado nesta rifa para sortear.");
        }
        const skip = Math.floor(Math.random() * totalBilhetesVendidos);
        const bilheteVencedor = await prisma.bilhetes.findFirst({
            where: { compra: { id_rifa_fk: id_rifa, status: 'aprovada' } },
            skip: skip,
            include: {
                compra: { include: { usuario: true } }
            }
        });
        if (!bilheteVencedor || !bilheteVencedor.compra || !bilheteVencedor.compra.usuario) {
            throw new Error("Falha ao selecionar um bilhete vencedor e encontrar o seu dono.");
        }
        const vencedor: Vencedor = {
            numero_bilhete: bilheteVencedor.numero_bilhete,
            id_discord: bilheteVencedor.compra.usuario.id_discord,
            nome: bilheteVencedor.compra.usuario.nome
        };

        await prisma.rifa.update({
            where: { id_rifa: id_rifa },
            data: { status: 'finalizada' }
        });
        rifa.status = 'finalizada'; 

        if (rifa.channel_id && rifa.message_id) {
            try {
                const channel = await client.channels.fetch(rifa.channel_id) as TextChannel;
                const message = await channel.messages.fetch(rifa.message_id);
                const winnerData = await buildRaffleWinnerEmbed(rifa, vencedor); 
                await message.edit(winnerData); 
            } catch (msgError) { 
                Logger.error(CONTEXT, `Erro ao atualizar msg pública (sortear #${id_rifa})`, msgError);
            }
        }
        
        Logger.info(CONTEXT, `Rifa #${id_rifa} sorteada (drak). Vencedor: ${vencedor.nome}`);
        await interaction.editReply(`🎉 Sorteio Realizado com Sucesso! Vencedor: ${vencedor.nome} (<@${vencedor.id_discord}>)`);
    } catch (error: any) {
        Logger.error(CONTEXT, `Erro ao sortear (drak) rifa #${id_rifa}`, error);
        await interaction.editReply(`❌ Erro ao sortear: ${error.message}`);
    }
}

// ... (A função 'cancelarRifa' não muda) ...
export async function cancelarRifa(id_rifa: number, motivo: string, client: ExtendedClient, interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        Logger.info(CONTEXT, `Tentando cancelar rifa #${id_rifa}. Motivo: ${motivo}`);
        const rifa: Rifa | null = await getRifaById(id_rifa);
        if (!rifa) throw new Error("Rifa não encontrada.");
        if (rifa.status !== 'ativa') throw new Error(`Esta rifa não pode ser cancelada (Status atual: '${rifa.status}').`);
        
        await prisma.rifa.update({
            where: { id_rifa: id_rifa },
            data: { status: 'cancelada' }
        });

        if (rifa.channel_id && rifa.message_id) {
            try {
                const channel = await client.channels.fetch(rifa.channel_id) as TextChannel;
                const message = await channel.messages.fetch(rifa.message_id);
                const cancelledData = buildRaffleCancelledEmbed(rifa, motivo);
                await message.edit(cancelledData); 
            } catch (msgError) { 
                Logger.error(CONTEXT, `Erro ao atualizar msg pública (cancelar #${id_rifa})`, msgError);
            }
        }
        
        Logger.info(CONTEXT, `Rifa #${id_rifa} cancelada.`);
        await interaction.editReply(`🗑️ Rifa #${id_rifa} cancelada com sucesso.`);
    } catch (error: any) {
        Logger.error(CONTEXT, `Erro ao cancelar rifa #${id_rifa}`, error);
        await interaction.editReply(`❌ Erro ao cancelar: ${error.message}`);
    }
}


// ... (A função 'getLotteryWinnerNumber' não muda) ...
function getLotteryWinnerNumber(totalBilhetes: number, numeroSorteado: string): string {
    let requiredLength = String(totalBilhetes - 1).length;
    const winnerNumber = numeroSorteado.slice(-requiredLength);
    return winnerNumber.padStart(requiredLength, '0');
}

// ... (A função 'finalizarRifaLoteria' não muda) ...
export async function finalizarRifaLoteria(id_rifa: number, numero_sorteado_input: string, client: ExtendedClient, interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    if (!/^\d+$/.test(numero_sorteado_input)) { 
        return interaction.editReply("O número sorteado deve conter apenas dígitos."); 
    }
    
    try {
        Logger.info(CONTEXT, `Tentando finalizar (loteria) rifa #${id_rifa} com o número ${numero_sorteado_input}`);
        const rifa: Rifa | null = await getRifaById(id_rifa);
        if (!rifa) throw new Error("Rifa não encontrada.");
        if (rifa.metodo_sorteio !== 'loteria') throw new Error("Esta rifa não é do método 'loteria'.");
        if (rifa.status !== 'aguardando_sorteio') throw new Error(`Esta rifa não está 'aguardando_sorteio' (Status: ${rifa.status}).`);

        const bilheteVencedorStr = getLotteryWinnerNumber(rifa.total_bilhetes, numero_sorteado_input);
        const bilheteVencedor = await prisma.bilhetes.findFirst({
            where: {
                compra: { id_rifa_fk: id_rifa, status: 'aprovada' },
                numero_bilhete: bilheteVencedorStr
            },
            include: {
                compra: { include: { usuario: true } }
            }
        });

        if (!bilheteVencedor || !bilheteVencedor.compra || !bilheteVencedor.compra.usuario) {
            await prisma.rifa.update({
                where: { id_rifa: id_rifa },
                data: { status: 'finalizada' }
            });
            Logger.info(CONTEXT, `Sorteio (loteria) rifa #${id_rifa} finalizado. Bilhete ${bilheteVencedorStr} não foi vendido.`);
            await interaction.editReply(`ℹ️ Sorteio da Loteria Registrado! Bilhete ${bilheteVencedorStr} não foi vendido.`);
            return; 
        }

        const vencedor: Vencedor = {
            numero_bilhete: bilheteVencedor.numero_bilhete,
            id_discord: bilheteVencedor.compra.usuario.id_discord,
            nome: bilheteVencedor.compra.usuario.nome
        };

        await prisma.rifa.update({
            where: { id_rifa: id_rifa },
            data: { status: 'finalizada' }
        });
        rifa.status = 'finalizada'; 

        if (rifa.channel_id && rifa.message_id) {
            try {
                const channel = await client.channels.fetch(rifa.channel_id) as TextChannel;
                const message = await channel.messages.fetch(rifa.message_id);
                const winnerData = await buildRaffleWinnerEmbed(rifa, vencedor); 
                await message.edit(winnerData); 
            } catch (msgError) { 
                Logger.error(CONTEXT, `Erro ao atualizar msg pública (finalizar-loteria #${id_rifa})`, msgError);
            }
        }
        
        Logger.info(CONTEXT, `Rifa #${id_rifa} finalizada (loteria). Vencedor: ${vencedor.nome}`);
        await interaction.editReply(`🎉 Sorteio da Loteria Finalizado! Vencedor: ${vencedor.nome} (<@${vencedor.id_discord}>)`);
    } catch (error: any) {
        Logger.error(CONTEXT, `Erro ao finalizar (loteria) rifa #${id_rifa}`, error);
        await interaction.editReply(`❌ Erro ao finalizar: ${error.message}`);
    }
}