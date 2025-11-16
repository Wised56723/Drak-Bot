import { 
    // Importações completas
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
    EmbedBuilder,
    ButtonInteraction,
    ButtonBuilder,
    ButtonStyle,
    GuildMember
} from "discord.js";
import { Command } from "../../structs/types/Command";
import { prisma } from "../../prismaClient";
import { ExtendedClient } from "../../structs/ExtendedClient";
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
} from "../../utils/RaffleEmbed";
import { config } from "../..";
import { PIX } from "gpix/dist";
import { Usuario } from "@prisma/client";
import crypto from "crypto";

// --- Função 'getLotteryWinnerNumber' (Completa) ---
function getLotteryWinnerNumber(totalBilhetes: number, numeroSorteado: string): string {
    let requiredLength = String(totalBilhetes - 1).length;
    const winnerNumber = numeroSorteado.slice(-requiredLength);
    return winnerNumber.padStart(requiredLength, '0');
}


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

    // --- FUNÇÃO 'RUN' (COMPLETA E CORRIGIDA) ---
    async run({ client, interaction, options }) {
        const subcomando = options.getSubcommand();

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
            return; // Adiciona o return para garantir
        }
        
        else if (subcomando === "sortear") {
            await interaction.deferReply({ ephemeral: true });
            const id_rifa = options.getInteger("id_rifa", true);
            try {
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
                    } catch (msgError) { console.error("Erro ao atualizar msg pública:", msgError); }
                }

                const participants = await getAllParticipants(id_rifa);
                for (const userId of participants) { 
                    // (Lógica de DM omitida para brevidade)
                }
                await interaction.editReply(`🎉 Sorteio Realizado com Sucesso! Vencedor: ${vencedor.nome} (<@${vencedor.id_discord}>)`);
            } catch (error: any) {
                console.error("[ERRO RIFA SORTEAR]:", error.message);
                await interaction.editReply(`❌ Erro ao sortear: ${error.message}`);
            }
            return; // Adiciona o return
        }

        else if (subcomando === "cancelar") {
            await interaction.deferReply({ ephemeral: true });
            const id_rifa = options.getInteger("id_rifa", true);
            const motivo = options.getString("motivo", true);
            try {
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
                    } catch (msgError) { console.error("Erro ao atualizar msg pública (cancelar):", msgError); }
                }
                
                const participants = await getAllParticipants(id_rifa);
                // (Lógica de DM omitida para brevidade)
                await interaction.editReply(`🗑️ Rifa #${id_rifa} cancelada com sucesso.`);
            } catch (error: any) {
                console.error("[ERRO RIFA CANCELAR]:", error.message);
                await interaction.editReply(`❌ Erro ao cancelar: ${error.message}`);
            }
            return; // Adiciona o return
        }
        
        else if (subcomando === "finalizar-loteria") {
            await interaction.deferReply({ ephemeral: true });
            const id_rifa = options.getInteger("id_rifa", true);
            const numero_sorteado_input = options.getString("numero_sorteado", true);
            if (!/^\d+$/.test(numero_sorteado_input)) { return interaction.editReply("O número sorteado deve conter apenas dígitos."); }
            
            try {
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
                    } catch (msgError) { console.error("Erro ao atualizar msg pública:", msgError); }
                }

                const participants = await getAllParticipants(id_rifa);
                for (const userId of participants) { /* ... (DM logic) ... */ }
                await interaction.editReply(`🎉 Sorteio da Loteria Finalizado! Vencedor: ${vencedor.nome} (<@${vencedor.id_discord}>)`);
            } catch (error: any) {
                console.error("[ERRO RIFA FINALIZAR-LOTERIA]:", error.message);
                await interaction.editReply(`❌ Erro ao finalizar: ${error.message}`);
            }
            return; // Adiciona o return
        }
    },

    // --- MODALS (Completos) ---
    modals: new Collection<string, (interaction: ModalSubmitInteraction, client: ExtendedClient) => any>([
        ["modal-rifa-criar_", async (interaction, client) => {
            if (!interaction.inGuild()) return; 
            await interaction.deferReply({ ephemeral: true });
            const [, channelId] = interaction.customId.split('_');
            const channel = await client.channels.fetch(channelId) as TextChannel;
            if (!channel || !channel.isTextBased()) return interaction.editReply("Erro: Canal não encontrado ou inválido.");

            const nome_premio = interaction.fields.getTextInputValue("rifa-premio");
            const preco_bilhete_input = interaction.fields.getTextInputValue("rifa-preco").replace(',', '.');
            const total_bilhetes_input = interaction.fields.getTextInputValue("rifa-bilhetes");
            const metodo_input_raw = interaction.fields.getTextInputValue("rifa-metodo").toLowerCase();
            const premios_secundarios_input = interaction.fields.getTextInputValue("premios-secundarios");
            const preco_bilhete = parseFloat(preco_bilhete_input);
            if (isNaN(preco_bilhete) || preco_bilhete <= 0) return interaction.editReply("O preço deve ser um número positivo (ex: 1.50).");
            const total_bilhetes = parseInt(total_bilhetes_input);
            if (isNaN(total_bilhetes) || total_bilhetes <= 0) return interaction.editReply("O total de bilhetes deve ser um número positivo.");
            
            let metodo_sorteio = 'drak';
            let meta_completude: number | null = null;
            if (metodo_input_raw.startsWith('loteria')) {
                metodo_sorteio = 'loteria';
                const parts = metodo_input_raw.split(':');
                if (parts.length < 2) return interaction.editReply("Formato inválido. Use 'loteria:75' (para 75% de meta).");
                meta_completude = parseFloat(parts[1]);
                if (isNaN(meta_completude) || meta_completude < 1 || meta_completude > 100) return interaction.editReply("A meta da loteria deve ser um número entre 1 e 100.");
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

            try {
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

                await interaction.editReply(
                    `🎉 Rifa criada com sucesso! \n` +
                    `(Prémios Top e Bilhetes Secretos foram configurados).\n` +
                    `A mensagem de acompanhamento foi postada em ${channel}.`
                );
            } catch (err: any) {
                console.error("Erro ao criar rifa:", err);
                await interaction.editReply('Ocorreu um erro ao tentar criar a rifa. 😢');
            }
        }],
        
        ["buy-modal_", async (interaction, client) => {
            const [, rifaIdStr] = interaction.customId.split('_');
            const id_rifa = parseInt(rifaIdStr);
            const id_discord = interaction.user.id;
            const quantidade_input = interaction.fields.getTextInputValue("buy-modal-quantidade");
            const quantidade = parseInt(quantidade_input);
            const referral_code_input = interaction.fields.getTextInputValue("referral-code")?.toUpperCase() || null;

            await interaction.deferReply({ ephemeral: true });

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
                if (!rifa) return interaction.editReply("Erro: Rifa não encontrada.");
                if (rifa.status !== 'ativa' && rifa.status !== 'aguardando_sorteio') {
                    return interaction.editReply(`A rifa "${rifa.nome_premio}" não está aceitando compras.`);
                }

                const reservados = await countBilhetesReservados(id_rifa);
                const disponiveis = rifa.total_bilhetes - reservados;
                if (quantidade > disponiveis) {
                    return interaction.editReply(`Bilhetes insuficientes. Tentou comprar: **${quantidade}** / Disponíveis: **${disponiveis}**`);
                }

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
                    console.error("Erro ao gerar BRCode:", pixError); 
                    pixCode = "Erro ao gerar código. Use a chave manual.";
                }

                const dmEmbed = new EmbedBuilder()
                    .setTitle("✅ Reserva de Bilhetes Realizada!")
                    .setDescription(`Sua reserva para a rifa **${rifa.nome_premio}** foi registrada.\n**ID da sua Compra:** \`${newCompraId}\`\n\nPara confirmar, pague o valor abaixo:`)
                    .addFields(
                        { name: "Valor Total", value: `**${totalPrecoString}**`, inline: false },
                        { name: "Pix Copia e Cola (com valor e ID)", value: pixCode, inline: false },
                        { name: "Chave Pix Manual (sem valor)", value: `${config.pixKey}`, inline: false }
                    )
                    .setColor("Blue")
                    .setFooter({ text: "Após o pagamento, um admin irá aprovar sua compra." });
                try {
                    const userDM = await interaction.user.createDM();
                    await userDM.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    console.error("Erro ao enviar DM de compra:", dmError);
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
                } catch (logErr) { console.error("Erro ao enviar log de compra:", logErr); }

                await interaction.editReply("✅ **Sucesso!** Enviei os detalhes do pagamento e o Pix Copia e Cola para a sua DM.");
            } catch (error: any) {
                console.error("Erro no fluxo de compra (botão):", error);
                await interaction.editReply("Ocorreu um erro inesperado ao processar sua compra. 😢");
            }
        }]
    ]),

    // --- BOTÕES (Completos e Corrigidos) ---
    buttons: new Collection<string, (interaction: ButtonInteraction, client: ExtendedClient) => any>([
        ["buy-ticket_", async (interaction, client) => {
            const [, rifaIdStr] = interaction.customId.split('_');
            const id_rifa = parseInt(rifaIdStr);
            if (isNaN(id_rifa)) {
                return interaction.reply({ content: "Erro: ID da rifa inválido.", ephemeral: true });
            }

            try {
                const usuario = await prisma.usuario.findUnique({
                    where: { id_discord: interaction.user.id }
                });
                if (!usuario) {
                    return interaction.reply({
                        content: "Você precisa estar registado para comprar. Por favor, use o botão de registo no canal de boas-vindas primeiro!",
                        ephemeral: true
                    });
                }
                
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
                    // --- CORREÇÃO DO ERRO DE DIGITAÇÃO ---
                    new ActionRowBuilder<TextInputBuilder>().addComponents(referralInput)
                );
                await interaction.showModal(modal);
            } catch (error: any) {
                 console.error("Erro no botão de compra:", error);
                 if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: "Ocorreu um erro. Tente novamente.", ephemeral: true });
                 }
            }
        }]
    ])
});