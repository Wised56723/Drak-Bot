import { EmbedBuilder, TextChannel } from "discord.js";
import db = require("../database.js");
import { ExtendedClient } from "../structs/ExtendedClient";

// Interface para o objeto Rifa (TypeScript)
// --- CORREÇÃO: ADICIONADO 'export' ---
export interface Rifa {
    id_rifa: number;
    nome_premio: string;
    total_bilhetes: number;
    status: string;
    metodo_sorteio: string;
    meta_completude: number | null;
    channel_id: string | null;
    message_id: string | null;
    preco_bilhete: number;
    sorteio_data: string | null; // NOVO
}

// Interface para o Vencedor
export interface Vencedor {
    id_discord: string;
    nome: string;
    numero_bilhete: string;
}

// Interface para a query de participantes
export interface UsuarioRifa {
    id_usuario_fk: string;
}

/**
 * Gera o Embed de status da Rifa
 * (Sem mudanças aqui)
 */
export function buildRaffleEmbed(rifa: Rifa, vendidos: number) {
    const embed = new EmbedBuilder();
    
    const progresso = (vendidos / rifa.total_bilhetes) * 100;
    const metodo = rifa.metodo_sorteio === 'drak' ? 'Sorteio pelo Drak Bot' : 'Sorteio pela Loteria Federal';
    const preco = rifa.preco_bilhete.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    embed.setTitle(`Rifa #${rifa.id_rifa}: ${rifa.nome_premio}`);
    embed.setDescription(`Participe da rifa e concorra a **${rifa.nome_premio}**!`);
    embed.setColor("Gold");
    
    embed.addFields(
        { 
            name: "🎟️ Progresso", 
            value: `**${vendidos} / ${rifa.total_bilhetes}** bilhetes vendidos (${progresso.toFixed(1)}%)`,
            inline: false 
        },
        { name: "💰 Preço por Bilhete", value: preco, inline: true },
        { name: "Mecânica", value: metodo, inline: true },
        { name: "Status", value: rifa.status.toUpperCase(), inline: true }
    );
    
    if (rifa.metodo_sorteio === 'loteria' && rifa.meta_completude) {
        embed.addFields({
            name: "Meta para Sorteio",
            value: `Atingir ${(rifa.meta_completude * 100)}% de vendas.`,
            inline: true
        });
    }

    embed.setFooter({ text: "Use /comprar na minha DM para garantir seus bilhetes." });
    embed.setTimestamp();

    return embed;
}

/**
 * Busca uma rifa no DB pelo ID
 * (Sem mudanças aqui)
 */
export function getRifaById(id: number): Promise<Rifa | null> {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM Rifas WHERE id_rifa = ?", [id], (err: Error, row: Rifa) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
}

/**
 * Conta quantos bilhetes foram aprovados para uma rifa
 * (Sem mudanças aqui)
 */
export function countBilhetesVendidos(rifaId: number): Promise<number> {
     return new Promise((resolve, reject) => {
        const sql = `
            SELECT COUNT(b.id_bilhete) as vendidos 
            FROM Bilhetes b
            JOIN Compras c ON b.id_compra_fk = c.id_compra
            WHERE c.id_rifa_fk = ? AND c.status = 'aprovada'
        `;
        
        db.get(sql, [rifaId], (err: Error, row: { vendidos: number }) => {
            if (err) return reject(err);
            resolve(row?.vendidos || 0);
        });
    });
}


/**
 * Atualiza a mensagem pública de uma rifa
 * (MODIFICADO para lidar com o novo status)
 */
export async function updateRaffleMessage(client: ExtendedClient, rifaId: number) {
    try {
        const rifa = await getRifaById(rifaId);
        if (!rifa || !rifa.channel_id || !rifa.message_id) {
            console.error(`[UPDATE]: Rifa ${rifaId} não encontrada ou não possui mensagem/canal.`);
            return;
        }

        const channel = await client.channels.fetch(rifa.channel_id) as TextChannel;
        if (!channel) return;

        const message = await channel.messages.fetch(rifa.message_id);
        if (!message) return;

        const vendidos = await countBilhetesVendidos(rifa.id_rifa);
        
        let newEmbed: EmbedBuilder;
        
        // Decide qual embed usar
        if (rifa.status === 'aguardando_sorteio' && rifa.sorteio_data) {
            newEmbed = buildRaffleAwaitingDrawEmbed(rifa, rifa.sorteio_data, vendidos);
        } else {
            newEmbed = buildRaffleEmbed(rifa, vendidos);
        }
        
        await message.edit({ embeds: [newEmbed] });
        console.log(`[UPDATE]: Mensagem da Rifa #${rifaId} atualizada.`);

    } catch (error) {
        console.error(`[ERRO UPDATE]: Falha ao atualizar mensagem da Rifa #${rifaId}:`, error);
    }
}

/**
 * Busca uma lista de IDs de todos os participantes (sem duplicatas)
 * (Sem mudanças aqui)
 */
export function getAllParticipants(rifaId: number): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT DISTINCT c.id_usuario_fk
            FROM Compras c
            WHERE c.id_rifa_fk = ? AND c.status = 'aprovada'
        `;
        
        db.all(sql, [rifaId], (err: Error, rows: UsuarioRifa[]) => {
            if (err) return reject(err);
            resolve(rows.map(r => r.id_usuario_fk));
        });
    });
}

/**
 * Gera o Embed de Vencedor
 * (Sem mudanças aqui)
 */
export function buildRaffleWinnerEmbed(rifa: Rifa, vencedor: Vencedor) {
    const embed = new EmbedBuilder()
    .setTitle(`🎉 Sorteio Finalizado! Rifa #${rifa.id_rifa}: ${rifa.nome_premio}`)
    .setDescription(`Temos um vencedor para a rifa **${rifa.nome_premio}**!`)
    .setColor("Green")
    .addFields(
        { name: "🏆 Vencedor", value: `**${vencedor.nome}** (<@${vencedor.id_discord}>)`, inline: false },
        { name: "Número Sorteado", value: `\`\`\`${vencedor.numero_bilhete}\`\`\``, inline: true },
        { name: "Status", value: "FINALIZADA", inline: true }
    )
    .setFooter({ text: "Obrigado a todos que participaram!" })
    .setTimestamp();
    return embed;
}

/**
 * Gera o Embed de Rifa Cancelada
 * (Sem mudanças aqui)
 */
export function buildRaffleCancelledEmbed(rifa: Rifa, motivo: string) {
    const embed = new EmbedBuilder()
    .setTitle(`❌ Rifa Cancelada - #${rifa.id_rifa}: ${rifa.nome_premio}`)
    .setDescription(`Esta rifa foi cancelada e não está mais ativa.`)
    .setColor("Red")
    .addFields(
        { name: "Status", value: "CANCELADA", inline: true },
        { name: "Motivo", value: motivo, inline: false }
    )
    .setFooter({ text: "Novas compras estão bloqueadas." })
    .setTimestamp();
    return embed;
}

/**
 * NOVO: Gera o Embed de "Aguardando Sorteio"
 */
export function buildRaffleAwaitingDrawEmbed(rifa: Rifa, sorteioDateISO: string, vendidos: number) {
    const embed = new EmbedBuilder();
    
    const progresso = (vendidos / rifa.total_bilhetes) * 100;
    const preco = rifa.preco_bilhete.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dataSorteio = new Date(sorteioDateISO).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });

    embed.setTitle(`Rifa #${rifa.id_rifa}: ${rifa.nome_premio}`);
    embed.setDescription(`**META ATINGIDA!** O sorteio foi agendado!`);
    embed.setColor("Blue");
    
    embed.addFields(
        { 
            name: "📅 Data do Sorteio (Loteria Federal)", 
            value: `**${dataSorteio}**`,
            inline: false 
        },
        { 
            name: "🎟️ Progresso", 
            value: `**${vendidos} / ${rifa.total_bilhetes}** bilhetes vendidos (${progresso.toFixed(1)}%)`,
            inline: false 
        },
        { name: "💰 Preço por Bilhete", value: preco, inline: true },
        { name: "Status", value: "AGUARDANDO SORTEIO", inline: true }
    );

    embed.setFooter({ text: "Boa sorte! As vendas continuam abertas até o sorteio." });
    embed.setTimestamp();

    return embed;
}