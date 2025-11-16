import { EmbedBuilder, TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { prisma } from "../prismaClient";
import type { Rifa, Usuario } from "@prisma/client";
// --- CORREÇÃO AQUI ---
export type { Rifa, Usuario } from "@prisma/client"; // Era "@prismaclient"
// --- FIM DA CORREÇÃO ---
import { ExtendedClient } from "../structs/ExtendedClient";

// --- INTERFACES (Corrigidas) ---
export interface Vencedor {
    id_discord: string;
    nome: string;
    numero_bilhete: string;
}
interface TopBuyer {
    id_discord: string;
    nome: string;
    total_comprado: number;
}
export type Premios = Record<string, string>;


// --- FUNÇÕES HELPER (Corrigidas) ---

/**
 * Busca o ranking de top compradores (IGNORA BILHETES GRÁTIS)
 */
async function getTopBuyers(rifaId: number, limit: number): Promise<TopBuyer[]> {
    
    // Lógica de Ranking (Corrigida)
    const comprasAgregadas = await prisma.compras.groupBy({
        by: ['id_usuario_fk'],
        where: {
            id_rifa_fk: rifaId,
            status: 'aprovada',
            bilhetes: {
                some: { is_free: false } // Apenas compras com bilhetes pagos
            }
        },
        _sum: {
            quantidade: true
        },
        orderBy: {
            _sum: {
                quantidade: 'desc'
            }
        },
        take: limit
    });

    if (comprasAgregadas.length === 0) return [];
    
    const userIds = comprasAgregadas.map(r => r.id_usuario_fk);
    const users = await prisma.usuario.findMany({ where: { id_discord: { in: userIds } } });
    const userMap = new Map(users.map(u => [u.id_discord, u.nome]));

    return comprasAgregadas.map(r => ({
        id_discord: r.id_usuario_fk,
        nome: userMap.get(r.id_usuario_fk) || "Utilizador Desconhecido",
        total_comprado: r._sum.quantidade || 0
    }));
}

/**
 * Conta bilhetes (vendidos + pendentes)
 */
export async function countBilhetesReservados(rifaId: number): Promise<number> {
     const result = await prisma.compras.aggregate({
        _sum: {
            quantidade: true
        },
        where: {
            id_rifa_fk: rifaId,
            status: { in: ['aprovada', 'em_analise'] }
        }
     });
     return result._sum.quantidade || 0;
}

/**
 * Constrói o texto do campo do ranking
 */
async function buildTopBuyersField(rifa: Rifa): Promise<string> {
    if (rifa.top_compradores_count === 0 || !rifa.top_compradores_premios) {
        return "";
    }
    
    const ranking = await getTopBuyers(rifa.id_rifa, rifa.top_compradores_count);
    const premios: Premios = JSON.parse(rifa.top_compradores_premios || "{}");
    if (ranking.length === 0) return "Ainda não há compradores no ranking.";

    const icons = ["🥇", "🥈", "🥉"];
    let text = "";
    ranking.forEach((buyer, index) => {
        const pos = index + 1;
        const icon = icons[index] || "🏅";
        const premioDesc = premios[pos] || "Prémio";
        text += `**${pos}. ${icon} ${buyer.nome} (${buyer.total_comprado} bilhetes)**\n`
              + `> *Prémio: ${premioDesc}*\n`;
    });
    return text;
}


/**
 * Gera o Embed de status da Rifa
 */
export async function buildRaffleEmbed(rifa: Rifa, vendidos: number) {
    const embed = new EmbedBuilder();
    const progresso = (vendidos / rifa.total_bilhetes) * 100;
    const metodo = rifa.metodo_sorteio === 'drak' ? 'Sorteio pelo Drak Bot' : 'Sorteio pela Loteria Federal';
    const preco = rifa.preco_bilhete;
    embed.setTitle(`Rifa #${rifa.id_rifa}: ${rifa.nome_premio}`);
    embed.setDescription(`Participe da rifa e concorra a **${rifa.nome_premio}**!`);
    embed.setColor("Gold");
    embed.addFields(
        { name: "🎟️ Progresso", value: `**${vendidos} / ${rifa.total_bilhetes}** (${progresso.toFixed(1)}%)`, inline: false },
        { name: "💰 Preço por Bilhete", value: preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), inline: true },
        { name: "Mecânica", value: metodo, inline: true },
        { name: "Status", value: rifa.status.toUpperCase(), inline: true }
    );
    if (rifa.metodo_sorteio === 'loteria' && rifa.meta_completude) {
        embed.addFields({ name: "Meta para Sorteio", value: `Atingir ${(rifa.meta_completude * 100)}% de vendas.`, inline: true });
    }
    if (rifa.top_compradores_count > 0) {
        const rankingText = await buildTopBuyersField(rifa);
        if (rankingText) {
            embed.addFields({ name: "🏆 Top Compradores", value: rankingText, inline: false });
        }
    }
    embed.setFooter({ text: "Clique no botão abaixo para comprar." });
    embed.setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`buy-ticket_${rifa.id_rifa}`)
                .setLabel("🎟️ Comprar Bilhete")
                .setStyle(ButtonStyle.Success)
        );

    return { embeds: [embed], components: [row] };
}

/**
 * Busca uma rifa no DB pelo ID
 */
export async function getRifaById(id: number): Promise<Rifa | null> {
    return prisma.rifa.findUnique({
        where: { id_rifa: id }
    });
}

/**
 * Conta quantos bilhetes foram aprovados para uma rifa
 */
export async function countBilhetesVendidos(rifaId: number): Promise<number> {
     return prisma.bilhetes.count({
        where: {
            compra: {
                id_rifa_fk: rifaId,
                status: 'aprovada'
            }
        }
     });
}


/**
 * Atualiza a mensagem pública de uma rifa
 */
export async function updateRaffleMessage(client: ExtendedClient, rifaId: number) {
    try {
        const rifa = await getRifaById(rifaId);
        if (!rifa || !rifa.channel_id || !rifa.message_id) return;
        
        const channel = await client.channels.fetch(rifa.channel_id) as TextChannel;
        if (!channel) return;
        
        const message = await channel.messages.fetch(rifa.message_id);
        if (!message) return;

        const vendidos = await countBilhetesVendidos(rifa.id_rifa);
        
        let messageData: { embeds: EmbedBuilder[], components: ActionRowBuilder<ButtonBuilder>[] };
        
        if (rifa.status === 'aguardando_sorteio' && rifa.sorteio_data) {
            messageData = await buildRaffleAwaitingDrawEmbed(rifa, rifa.sorteio_data.toISOString(), vendidos);
        } else {
            messageData = await buildRaffleEmbed(rifa, vendidos);
        }
        
        await message.edit(messageData);
        console.log(`[UPDATE]: Mensagem da Rifa #${rifaId} (e Ranking) atualizada.`);

    } catch (error) {
        console.error(`[ERRO UPDATE]: Falha ao atualizar mensagem da Rifa #${rifaId}:`, error);
    }
}

/**
 * Busca uma lista de IDs de todos os participantes (sem duplicatas)
 */
export async function getAllParticipants(rifaId: number): Promise<string[]> {
    const users = await prisma.compras.findMany({
        where: {
            id_rifa_fk: rifaId,
            status: 'aprovada'
        },
        select: {
            id_usuario_fk: true
        },
        distinct: ['id_usuario_fk']
    });
    return users.map(u => u.id_usuario_fk);
}

/**
 * Gera o Embed de Vencedor
 */
export async function buildRaffleWinnerEmbed(rifa: Rifa, vencedor: Vencedor) {
    const embed = new EmbedBuilder();
    embed.setTitle(`🎉 Sorteio Finalizado! Rifa #${rifa.id_rifa}: ${rifa.nome_premio}`);
    embed.setDescription(`Temos um vencedor para a rifa **${rifa.nome_premio}**!`);
    embed.setColor("Green");
    embed.addFields(
        { name: "🏆 Vencedor", value: `**${vencedor.nome}** (<@${vencedor.id_discord}>)`, inline: false },
        { name: "Número Sorteado", value: `\`\`\`${vencedor.numero_bilhete}\`\`\``, inline: true },
        { name: "Status", value: "FINALIZADA", inline: true }
    );
    if (rifa.top_compradores_count > 0) {
        const rankingText = await buildTopBuyersField(rifa);
        if (rankingText) {
            embed.addFields({ name: "🏆 Ranking Final Top Compradores", value: rankingText, inline: false });
        }
    }
    embed.setFooter({ text: "Obrigado a todos que participaram!" });
    embed.setTimestamp();
    return { embeds: [embed], components: [] };
}

/**
 * Gera o Embed de Rifa Cancelada
 */
export function buildRaffleCancelledEmbed(rifa: Rifa, motivo: string) {
    const embed = new EmbedBuilder();
    embed.setTitle(`❌ Rifa Cancelada - #${rifa.id_rifa}: ${rifa.nome_premio}`);
    embed.setDescription(`Esta rifa foi cancelada e não está mais ativa.`);
    embed.setColor("Red");
    embed.addFields(
        { name: "Status", value: "CANCELADA", inline: true },
        { name: "Motivo", value: motivo, inline: false }
    );
    embed.setFooter({ text: "Novas compras estão bloqueadas." });
    embed.setTimestamp();
    return { embeds: [embed], components: [] };
}

/**
 * Gera o Embed de "Aguardando Sorteio"
 */
export async function buildRaffleAwaitingDrawEmbed(rifa: Rifa, sorteioDateISO: string, vendidos: number) {
    const embed = new EmbedBuilder();
    const progresso = (vendidos / rifa.total_bilhetes) * 100;
    const preco = rifa.preco_bilhete;
    const dataSorteio = new Date(sorteioDateISO).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
    embed.setTitle(`Rifa #${rifa.id_rifa}: ${rifa.nome_premio}`);
    embed.setDescription(`**META ATINGIDA!** O sorteio foi agendado!`);
    embed.setColor("Blue");
    embed.addFields(
        { name: "📅 Data do Sorteio (Loteria Federal)", value: `**${dataSorteio}**`, inline: false },
        { name: "🎟️ Progresso", value: `**${vendidos} / ${rifa.total_bilhetes}** (${progresso.toFixed(1)}%)`, inline: false },
        { name: "💰 Preço por Bilhete", value: preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), inline: true },
        { name: "Status", value: "AGUARDANDO SORTEIO", inline: true }
    );
    if (rifa.top_compradores_count > 0) {
        const rankingText = await buildTopBuyersField(rifa);
        if (rankingText) {
            embed.addFields({ name: "🏆 Top Compradores", value: rankingText, inline: false });
        }
    }
    embed.setFooter({ text: "Boa sorte! As vendas continuam abertas." });
    embed.setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`buy-ticket_${rifa.id_rifa}`)
                .setLabel("🎟️ Comprar Bilhete")
                .setStyle(ButtonStyle.Success)
        );

    return { embeds: [embed], components: [row] };
}