// src/services/GestaoService.ts

import { ExtendedClient } from "../structs/ExtendedClient";
import { prisma } from "../prismaClient";
import { updateRaffleMessage } from "../utils/RaffleEmbed";
import { EmbedBuilder } from "discord.js";
import { Logger, LogContext } from "../utils/Logger"; // Corrigido: Importa LogContext
import { Prisma } from "@prisma/client"; // Necessário para tipos

const CONTEXT: LogContext = "GestaoService"; // Contexto para os logs

// Define o tipo de retorno da transação
type AprovacaoResult = {
    novosNumeros: string[];
    premiosGanhos: { numero: string, premio: string }[];
    compra: { 
        id_rifa_fk: number;
        id_usuario_fk: string;
        quantidade: number;
        id_indicador_fk: string | null;
        rifa: {
            preco_bilhete: number;
            total_bilhetes: number;
            id_rifa: number;
        }
    };
    bonusMessage: string;
}

/**
 * Lógica de negócio para aprovar uma compra.
 * (Código original movido de gestao.ts)
 */
export async function aprovarCompra(id_compra: number, client: ExtendedClient): Promise<string> {
    
    Logger.info(CONTEXT, `Iniciando aprovação da compra #${id_compra}...`);
    
    // --- CORREÇÃO: 'bonusMessage' definido aqui ---
    let bonusMessage = "";
    
    // --- CORREÇÃO: Adicionado 'Promise<AprovacaoResult>' para tipagem explícita ---
    const { novosNumeros, premiosGanhos, compra } = await prisma.$transaction(async (tx): Promise<AprovacaoResult> => {
        
        const compra = await tx.compras.findUnique({
            where: { id_compra: id_compra },
            select: {
                id_compra: true,
                id_rifa_fk: true,
                id_usuario_fk: true,
                quantidade: true,
                status: true,
                id_indicador_fk: true,
                rifa: true
            }
        });

        if (!compra) throw new Error("Compra não encontrada.");
        if (compra.status !== 'em_analise') throw new Error(`Já está com status '${compra.status}'.`);
        
        const rifa = compra.rifa;

        const padding = String(rifa.total_bilhetes - 1).length;
        
        const soldTicketsResult = await tx.bilhetes.findMany({
            where: { compra: { id_rifa_fk: rifa.id_rifa } },
            select: { numero_bilhete: true }
        });
        const soldTicketSet = new Set(soldTicketsResult.map(r => r.numero_bilhete));

        const secretPrizeTickets = await tx.premiosInstantaneos.findMany({
            where: { id_rifa_fk: rifa.id_rifa, status: 'pendente' },
            select: { numero_bilhete: true }
        });
        const secretPrizeSet = new Set(secretPrizeTickets.map(p => p.numero_bilhete));

        const vendidos = soldTicketSet.size;
        if (vendidos + compra.quantidade > rifa.total_bilhetes) {
            throw new Error(`Excede o total! (${vendidos} + ${compra.quantidade} > ${rifa.total_bilhetes} total)`);
        }

        const availableTickets: string[] = [];
        for (let i = 0; i < rifa.total_bilhetes; i++) {
            const numeroBilhete = String(i).padStart(padding, '0');
            if (!soldTicketSet.has(numeroBilhete)) {
                availableTickets.push(numeroBilhete);
            }
        }

        for (let i = availableTickets.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [availableTickets[i], availableTickets[j]] = [availableTickets[j], availableTickets[i]];
        }

        // --- CORREÇÃO: Tipo 'novosNumeros' definido explicitamente ---
        let novosNumeros: string[] = [];
        const availableBonusTickets: string[] = [];
        const availablePrizeTickets: string[] = [];
        
        availableTickets.forEach((num: string) => {
            if (secretPrizeSet.has(num)) {
                availablePrizeTickets.push(num);
            } else {
                availableBonusTickets.push(num);
            }
        });

        if (availableBonusTickets.length < compra.quantidade) {
            const needed = compra.quantidade - availableBonusTickets.length;
            const extraPrizeTickets = availablePrizeTickets.slice(0, needed);
            novosNumeros = [...availableBonusTickets, ...extraPrizeTickets];
        } else {
            novosNumeros = availableBonusTickets.slice(0, compra.quantidade);
        }
        
        for (let i = novosNumeros.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [novosNumeros[i], novosNumeros[j]] = [novosNumeros[j], novosNumeros[i]];
        }

        await tx.compras.update({
            where: { id_compra: id_compra },
            data: { status: 'aprovada' }
        });

        await tx.bilhetes.createMany({
            data: novosNumeros.map((numero: string) => ({
                id_compra_fk: id_compra,
                numero_bilhete: numero,
                is_free: false
            }))
        });

        const premiosGanhos: { numero: string, premio: string }[] = [];
        const premiosPendentes = await tx.premiosInstantaneos.findMany({
            where: {
                id_rifa_fk: compra.id_rifa_fk,
                status: 'pendente',
                numero_bilhete: { in: novosNumeros } 
            }
        });

        if (premiosPendentes.length > 0) {
            for (const premio of premiosPendentes) {
                premiosGanhos.push({ numero: premio.numero_bilhete, premio: premio.descricao_premio });
                await tx.premiosInstantaneos.update({
                    where: { id_premio: premio.id_premio },
                    data: { status: 'reivindicado', id_usuario_vencedor_fk: compra.id_usuario_fk }
                });
                soldTicketSet.add(premio.numero_bilhete);
            }
        }
        
        novosNumeros.forEach((n: string) => soldTicketSet.add(n));

        // bonusMessage é definida no escopo externo
        bonusMessage = "";
        const totalPreco = compra.quantidade * rifa.preco_bilhete;
        
        if (compra.id_indicador_fk && totalPreco >= 10) { 
            const freeTicketsCount = await tx.bilhetes.count({
                where: {
                    compra: { id_rifa_fk: rifa.id_rifa, id_usuario_fk: compra.id_indicador_fk },
                    is_free: true
                }
            });

            if (freeTicketsCount < 5) {
                const availableForBonus: string[] = [];
                for (let i = 0; i < rifa.total_bilhetes; i++) {
                    const num = String(i).padStart(padding, '0');
                    if (!soldTicketSet.has(num) && !secretPrizeSet.has(num)) {
                        availableForBonus.push(num);
                    }
                }
                
                if (availableForBonus.length > 0) {
                    const bonusTicketNumero = availableForBonus[Math.floor(Math.random() * availableForBonus.length)];
                    soldTicketSet.add(bonusTicketNumero); 
                    
                    const bonusCompra = await tx.compras.create({
                        data: {
                            id_rifa_fk: rifa.id_rifa,
                            id_usuario_fk: compra.id_indicador_fk,
                            data_compra: new Date(),
                            quantidade: 1,
                            status: 'aprovada'
                        }
                    });
                    
                    await tx.bilhetes.create({
                        data: {
                            id_compra_fk: bonusCompra.id_compra,
                            numero_bilhete: bonusTicketNumero,
                            is_free: true
                        }
                    });
                    
                    bonusMessage = `BÓNUS: <@${compra.id_indicador_fk}> (Indicador) ganhou 1 bilhete grátis (\`${bonusTicketNumero}\`)!`;
                }
            }
        }
        
        Logger.info(CONTEXT, `Transação da compra #${id_compra} concluída.`);
        return { novosNumeros, premiosGanhos, compra, bonusMessage };

    }, {
       // Configuração da transação (opcional, mas bom para concorrência)
       maxWait: 5000, 
       timeout: 10000,
       isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    // --- CORREÇÃO: Lógica de DM e 'respostaAdmin' movida para cá ---
    try {
        const user = await client.users.fetch(compra.id_usuario_fk);
        // --- CORREÇÃO: 'dmEmbed' definido aqui ---
        const dmEmbed = new EmbedBuilder()
            .setTitle(`✅ Compra Aprovada (Rifa #${compra.id_rifa_fk})`)
            .setDescription(`Sua compra de **${compra.quantidade} bilhete(s)** foi aprovada!`)
            .addFields({ name: "Seus Números da Sorte (Aleatórios)", value: `\`\`\`${novosNumeros.join(', ')}\`\`\`` })
            .setColor("Green").setTimestamp();
        if (premiosGanhos.length > 0) {
            dmEmbed.addFields({
                name: "🎉 BILHETE PREMIADO! 🎉",
                value: premiosGanhos.map((p: { numero: string, premio: string }) => `O seu bilhete \`${p.numero}\` ganhou: **${p.premio}**!`).join('\n')
            });
            dmEmbed.setColor("Gold");
        }
        await user.send({ embeds: [dmEmbed] });
    } catch (dmError) { 
        Logger.error(CONTEXT, `Erro ao enviar DM (aprovar) para ${compra.id_usuario_fk}`, dmError);
    }
    
    if (bonusMessage && compra.id_indicador_fk) {
        try {
            const indicadorUser = await client.users.fetch(compra.id_indicador_fk);
            const convidado = await client.users.fetch(compra.id_usuario_fk);
            const dmBonusEmbed = new EmbedBuilder()
                .setTitle(`🎟️ Você ganhou um Bilhete Bónus!`)
                .setDescription(`O seu indicado **${convidado.username}** fez uma compra válida na Rifa #${compra.id_rifa_fk}.\n\n${bonusMessage.replace('BÓNUS: ', '')}`)
                .setColor("Green");
            await indicadorUser.send({ embeds: [dmBonusEmbed] });
        } catch (dmError) { 
            Logger.error(CONTEXT, `Erro ao enviar DM de bónus para ${compra.id_indicador_fk}`, dmError);
        }
    }

    await updateRaffleMessage(client, compra.id_rifa_fk);

    // --- CORREÇÃO: 'respostaAdmin' definida aqui ---
    let respostaAdmin = `Aprovada (<@${compra.id_usuario_fk}>, ${novosNumeros.join(', ')})`;
    if (premiosGanhos.length > 0) {
        const premioTxt = premiosGanhos.map((p: { numero: string, premio: string }) => `Bilhete \`${p.numero}\` ganhou **${p.premio}**`).join(', ');
        respostaAdmin += `\n**BINGO! <@${compra.id_usuario_fk}> ganhou:** ${premioTxt}`;
    }
    if (bonusMessage) {
        respostaAdmin += `\n**${bonusMessage}**`;
    }

    Logger.info(CONTEXT, `Compra #${id_compra} aprovada com sucesso.`);
    return respostaAdmin;
}

/**
 * Lógica de negócio para rejeitar uma compra.
 * (Código original movido de gestao.ts)
 */
export async function rejeitarCompra(id_compra: number, motivo: string, client: ExtendedClient): Promise<string> {
    Logger.info(CONTEXT, `Iniciando rejeição da compra #${id_compra}...`);
    
    const compra = await prisma.compras.findUnique({
        // --- CORREÇÃO: Adicionado o 'where' que faltava ---
        where: { id_compra: id_compra },
        select: {
            id_compra: true,
            id_rifa_fk: true,
            id_usuario_fk: true,
            quantidade: true,
            status: true
        }
    });
    
    if (!compra) throw new Error("Compra não encontrada.");
    if (compra.status !== 'em_analise') throw new Error(`Já está com status '${compra.status}'.`);

    await prisma.compras.update({
        where: { id_compra: id_compra },
        data: { status: 'rejeitada' }
    });

    try {
        const user = await client.users.fetch(compra.id_usuario_fk);
        // --- CORREÇÃO: 'dmEmbed' definido aqui ---
        const dmEmbed = new EmbedBuilder()
            .setTitle(`❌ Compra Rejeitada (Rifa #${compra.id_rifa_fk})`)
            .setDescription(`Sua compra (ID: \`${id_compra}\`) de **${compra.quantidade} bilhete(s)** foi rejeitada.`)
            .addFields({ name: "Motivo da Rejeição", value: motivo })
            .setColor("Red")
            .setTimestamp();
        await user.send({ embeds: [dmEmbed] });
    } catch (dmError) {
        Logger.error(CONTEXT, `Erro ao enviar DM (rejeitar) para ${compra.id_usuario_fk}`, dmError);
    }
    
    Logger.info(CONTEXT, `Compra #${id_compra} rejeitada.`);
    return `Rejeitada (<@${compra.id_usuario_fk}>)`;
}

/**
 * Busca todos os IDs pendentes
 */
export async function getPendingCompraIds(): Promise<number[]> {
    const compras = await prisma.compras.findMany({
        where: { status: 'em_analise' },
        select: { id_compra: true }
    });
    return compras.map(c => c.id_compra);
}