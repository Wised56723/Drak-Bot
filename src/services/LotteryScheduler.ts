import { EmbedBuilder, TextChannel } from "discord.js";
import { ExtendedClient } from "../structs/ExtendedClient";
// NOVO: Importa o Prisma e tipos
import { prisma } from "../prismaClient";
import { Rifa } from "@prisma/client";
// NOVO: Importa apenas as funções necessárias
import { countBilhetesVendidos, getAllParticipants, updateRaffleMessage } from "../utils/RaffleEmbed";

const CHECK_INTERVAL = 24 * 60 * 60 * 1000; 

// ... (função calculateNextDrawDate não muda) ...
function calculateNextDrawDate(): Date {
    const now = new Date();
    now.setHours(now.getHours() - 3);
    const dayOfWeek = now.getDay(); 
    let daysToAdd = 0;
    if (dayOfWeek < 3) { daysToAdd = 3 - dayOfWeek; }
    else if (dayOfWeek < 6) { daysToAdd = 6 - dayOfWeek; }
    else { daysToAdd = 4; }
    const drawDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToAdd);
    return drawDate;
}

/**
 * Processa uma rifa que atingiu a meta
 */
async function processRifaMetaHit(client: ExtendedClient, rifa: Rifa) {
    try {
        console.log(`[LOTERIA]: Rifa #${rifa.id_rifa} atingiu a meta. Processando...`);

        const drawDate = calculateNextDrawDate();
        const drawDateString = drawDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

        // 1. Atualiza o DB com Prisma
        await prisma.rifa.update({
            where: { id_rifa: rifa.id_rifa },
            data: {
                status: 'aguardando_sorteio',
                sorteio_data: drawDate
            }
        });

        // 2. Atualiza a Mensagem Pública
        // A 'updateRaffleMessage' agora sabe como lidar com o status 'aguardando_sorteio'
        await updateRaffleMessage(client, rifa.id_rifa);

        // 3. Notificar todos os participantes
        const participants = await getAllParticipants(rifa.id_rifa);
        const dmEmbed = new EmbedBuilder()
            .setTitle(`🗓️ Sorteio Agendado! (Rifa #${rifa.id_rifa})`)
            .setDescription(`A rifa **${rifa.nome_premio}** atingiu a meta de vendas!`)
            .addFields({
                name: "Data do Sorteio",
                value: `O sorteio ocorrerá pela Loteria Federal no dia **${drawDateString}**.`,
            })
            .setColor("Blue")
            .setFooter({ text: "As vendas continuam. Boa sorte!" });

        for (const userId of participants) {
            try {
                const user = await client.users.fetch(userId);
                await user.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                console.error(`Erro ao enviar DM (Loteria) para ${userId}:`, dmError);
            }
        }
        console.log(`[LOTERIA]: Rifa #${rifa.id_rifa} processada. Sorteio em ${drawDateString}.`);

    } catch (error) {
        console.error(`[ERRO LOTERIA]: Falha ao processar rifa #${rifa.id_rifa}:`, error);
    }
}

/**
 * Verifica todas as rifas 'ativas' do tipo 'loteria'
 */
async function checkLotteryRifas(client: ExtendedClient) {
    console.log("[LOTERIA]: Verificando rifas 'loteria' ativas...");
    try {
        // 1. Busca rifas com Prisma
        const rifas = await prisma.rifa.findMany({
            where: {
                metodo_sorteio: 'loteria',
                status: 'ativa'
            }
        });

        if (rifas.length === 0) {
            console.log("[LOTERIA]: Nenhuma rifa 'loteria' ativa encontrada.");
            return;
        }

        for (const rifa of rifas) {
            const vendidos = await countBilhetesVendidos(rifa.id_rifa);
            const meta_necessaria = rifa.total_bilhetes * (rifa.meta_completude || 1.0);

            if (vendidos >= meta_necessaria) {
                await processRifaMetaHit(client, rifa);
            }
        }
    } catch (error) {
        console.error("[ERRO LOTERIA]: Falha no loop de verificação:", error);
    }
}

/**
 * Inicia o serviço de verificação da loteria
 */
export function startLotteryScheduler(client: ExtendedClient) {
    console.log("[LOTERIA]: Serviço de Sorteio da Loteria iniciado.");
    checkLotteryRifas(client); 
    setInterval(() => checkLotteryRifas(client), CHECK_INTERVAL);
}