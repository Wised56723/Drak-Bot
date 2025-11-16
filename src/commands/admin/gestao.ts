import { 
    ApplicationCommandType, 
    ApplicationCommandOptionType,
    PermissionFlagsBits, TextChannel, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ButtonInteraction, Collection, ModalBuilder,
    TextInputBuilder, TextInputStyle, ModalSubmitInteraction
} from "discord.js";
import { Command } from "../../structs/types/Command";
import { prisma } from "../../prismaClient";
import { updateRaffleMessage } from "../../utils/RaffleEmbed";
import { ExtendedClient } from "../../structs/ExtendedClient";
import { Compras, Rifa } from "@prisma/client";

// --- Interfaces (Sem mudança) ---
interface PremioSecreto {
    id_premio: number;
    descricao_premio: string;
}

// --- LÓGICA DE APROVAÇÃO (COMPLETA) ---
async function aprovarCompra(id_compra: number, client: ExtendedClient): Promise<string> {
    
    let bonusMessage = "";
    
    // Define o tipo de retorno da transação
    type AprovacaoResult = {
        novosNumeros: string[];
        premiosGanhos: { numero: string, premio: string }[];
        compra: { // Define os campos que precisamos de 'compra'
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
    
    const { novosNumeros, premiosGanhos, compra } = await prisma.$transaction<AprovacaoResult>(async (tx) => {
        
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

        let bonusMessage = "";
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
        
        return { novosNumeros, premiosGanhos, compra, bonusMessage };
    });

    try {
        const user = await client.users.fetch(compra.id_usuario_fk);
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
    } catch (dmError) { console.error("Erro ao enviar DM (aprovar):", dmError); }
    
    if (bonusMessage && compra.id_indicador_fk) {
        try {
            const indicadorUser = await client.users.fetch(compra.id_indicador_fk);
            const convidado = await client.users.fetch(compra.id_usuario_fk);
            const dmBonusEmbed = new EmbedBuilder()
                .setTitle(`🎟️ Você ganhou um Bilhete Bónus!`)
                .setDescription(`O seu indicado **${convidado.username}** fez uma compra válida na Rifa #${compra.id_rifa_fk}.\n\n${bonusMessage.replace('BÓNUS: ', '')}`)
                .setColor("Green");
            await indicadorUser.send({ embeds: [dmBonusEmbed] });
        } catch (dmError) { console.error("Erro ao enviar DM de bónus:", dmError); }
    }

    await updateRaffleMessage(client, compra.id_rifa_fk);

    let respostaAdmin = `Aprovada (<@${compra.id_usuario_fk}>, ${novosNumeros.join(', ')})`;
    if (premiosGanhos.length > 0) {
        const premioTxt = premiosGanhos.map((p: { numero: string, premio: string }) => `Bilhete \`${p.numero}\` ganhou **${p.premio}**`).join(', ');
        respostaAdmin += `\n**BINGO! <@${compra.id_usuario_fk}> ganhou:** ${premioTxt}`;
    }
    if (bonusMessage) {
        respostaAdmin += `\n**${bonusMessage}**`;
    }
    return respostaAdmin;
}

// --- LÓGICA DE REJEIÇÃO (COMPLETA) ---
async function rejeitarCompra(id_compra: number, motivo: string, client: ExtendedClient): Promise<string> {
    
    const compra = await prisma.compras.findUnique({
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
    
    return `Rejeitada (<@${compra.id_usuario_fk}>)`;
}

// --- HELPER: Buscar todos os IDs pendentes (COMPLETO) ---
async function getPendingCompraIds(): Promise<number[]> {
    const compras = await prisma.compras.findMany({
        where: { status: 'em_analise' },
        select: { id_compra: true }
    });
    return compras.map(c => c.id_compra);
}


// --- EXPORTAÇÃO DO COMANDO (COMPLETO) ---
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
        }
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
                console.error("[ERRO GESTÃO LISTAR]:", error.message);
                await interaction.editReply(`❌ Erro ao listar compras: ${error.message}`);
            }
        }
    },

    // --- BOTÕES (COMPLETOS) ---
    buttons: new Collection<string, (interaction: ButtonInteraction, client: ExtendedClient) => any>([
        // Botões de Log
        ["log-approve_", async (interaction, client) => {
            await interaction.deferUpdate(); 
            if (!interaction.message) {
                console.error("Interaction message é null (log-approve_)");
                return;
            }
            
            const [, id_compra_str] = interaction.customId.split('_');
            const id_compra = parseInt(id_compra_str);
            if (isNaN(id_compra)) {
                return interaction.followUp({ content: "Erro de ID no botão.", ephemeral: true });
            }

            try {
                const msg = await aprovarCompra(id_compra, client);
                const originalEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(originalEmbed)
                    .setTitle(`✅ COMPRA #${id_compra} APROVADA`)
                    .setColor("Green")
                    .setDescription(
                        originalEmbed.description + 
                        `\n\n**Aprovada por:** <@${interaction.user.id}>\n**Detalhes:** ${msg}`
                    );
                await interaction.message.edit({ embeds: [newEmbed], components: [] });
            } catch (error: any) {
                console.error("[ERRO LOG APPROVE]:", error.message);
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
                console.error("[ERRO GRAVE] Falha ao MOSTRAR o modal de rejeição:", error);
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
            const pendingIds = await getPendingCompraIds();
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
        ["gestao-cancelar-acao", (interaction) => {
            interaction.deleteReply();
        }],
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

    // --- MODALS (Completos) ---
    modals: new Collection<string, (interaction: ModalSubmitInteraction, client: ExtendedClient) => any>([
        // Modal: Rejeição do Log
        ["log-reject-modal_", async (interaction, client) => {
            await interaction.deferUpdate();
            if (!interaction.message) {
                console.error("Interaction message é null (log-reject-modal_)");
                return;
            }

            const [, id_compra_str] = interaction.customId.split('_');
            const id_compra = parseInt(id_compra_str);
            const motivo = interaction.fields.getTextInputValue("log-reject-motivo");

            if (isNaN(id_compra)) {
                return interaction.followUp({ content: "Erro de ID no modal.", ephemeral: true });
            }

            try {
                const msg = await rejeitarCompra(id_compra, motivo, client);
                const originalEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(originalEmbed)
                    .setTitle(`❌ COMPRA #${id_compra} REJEITADA`)
                    .setColor("Red")
                    .setDescription(
                        originalEmbed.description + 
                        `\n\n**Rejeitada por:** <@${interaction.user.id}>\n**Motivo:** ${motivo}`
                    );
                await interaction.message.edit({ embeds: [newEmbed], components: [] });
            } catch (error: any) {
                console.error("[ERRO LOG REJECT]:", error.message);
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

        // Modal: Rejeição de TODOS
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