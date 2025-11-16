// src/services/SetupService.ts

import { ModalSubmitInteraction, GuildMember, EmbedBuilder } from "discord.js";
import { ExtendedClient } from "../structs/ExtendedClient";
import { prisma } from "../prismaClient";
import { Logger, LogContext } from "../utils/Logger";
// --- REMOVIDO: import { config } from ".."; ---
import crypto from "crypto"; 

const CONTEXT: LogContext = "Comando";
const emailRegex = /\S+@\S+\.\S+/;

// ... (Função generateUniqueReferralCode não muda) ...
async function generateUniqueReferralCode(nome: string): Promise<string> {
    const nomeBase = nome.split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').substring(0, 5);
    let referralCode = `${nomeBase}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    try {
        const existingCode = await prisma.usuario.findUnique({ where: { referral_code: referralCode } });
        if (existingCode) {
            referralCode = `USER-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        }
    } catch (codeError) {
        Logger.warn(CONTEXT, "Falha não-crítica ao verificar código de referência duplicado.", codeError);
    }
    return referralCode;
}

/**
 * Lógica de negócio para processar o registo de um novo utilizador.
 */
export async function processarRegisto(interaction: ModalSubmitInteraction, client: ExtendedClient) {
    
    const nome = interaction.fields.getTextInputValue("cadastro-nome");
    const email = interaction.fields.getTextInputValue("cadastro-email");
    const id_discord = interaction.user.id;

    if (!interaction.inGuild()) {
        return interaction.reply({ content: "Esta interação deve ocorrer dentro de um servidor.", ephemeral: true });
    }
    if (!emailRegex.test(email)) {
        return interaction.reply({ content: "Esse email não parece válido.", ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        Logger.info(CONTEXT, `Tentando registar novo utilizador: ${nome} (${id_discord}) com email ${email}`);
        
        const referralCode = await generateUniqueReferralCode(nome);
        
        await prisma.usuario.create({
            data: {
                id_discord: id_discord,
                nome: nome,
                email: email,
                referral_code: referralCode
            }
        });

        // --- CORREÇÃO AQUI ---
        const roleId = process.env.MEMBRO_REGISTADO_ROLE_ID; 
        if (!roleId) {
            Logger.error(CONTEXT, "ERRO CRÍTICO: 'MEMBRO_REGISTADO_ROLE_ID' não definida nas variáveis de ambiente.", null);
            return interaction.editReply("Registo salvo, mas ocorreu um erro ao atualizar as suas permissões. Contacte um admin.");
        }
        const member = interaction.member as GuildMember;
        await member.roles.add(roleId);
        // --- FIM DA CORREÇÃO ---

        Logger.info(CONTEXT, `Utilizador ${nome} (${id_discord}) registado com sucesso. Código: ${referralCode}`);

        const dmEmbed = new EmbedBuilder()
            .setTitle(`🎉 Registo Concluído com Sucesso!`)
            .setDescription(`Bem-vindo(a) ao servidor, **${nome}**!\n\nO seu registo foi efetuado e você já tem acesso a todos os canais.`)
            .addFields({
                name: "O Seu Código de Indicador Pessoal",
                value: `Guarde este código! Se um amigo o usar numa compra acima de R$ 10,00 (e você também tiver bilhetes nessa rifa), você ganha um bilhete grátis (máximo de 5 por rifa)!`
            })
            .setColor("Green")
            .setTimestamp();
        
        try {
            await interaction.user.send({ embeds: [dmEmbed] });
            await interaction.user.send(referralCode);
            await interaction.editReply("Registo concluído com sucesso! ✅ Enviei o seu código de indicador para a sua DM.");
        
        } catch (dmError) {
            Logger.warn(CONTEXT, `Falha ao enviar DM de registo para ${id_discord}. DMs podem estar fechadas.`, dmError);
            
            const replyContent = `Registo concluído, ${nome}! 🎉\n` +
                `**Não consegui enviar o seu código por DM!** (As suas DMs podem estar privadas).\n\n` +
                `Guarde o seu Código de Indicador (toque para copiar):\n` +
                `\`\`\`${referralCode}\`\`\``;

            await interaction.editReply({ content: replyContent });
        }

    } catch (err: any) {
        if (err.code === 'P2002') { // Utilizador Duplicado
            Logger.warn(CONTEXT, `Tentativa de registo duplicado por ${id_discord} (email ou ID)`);
            try {
                let respostaPublica = 'Parece que você já está registado. Verifiquei as suas permissões! ✅';
                let dmMessage = "Parece que você já estava registado! Verifiquei as suas permissões no servidor e está tudo certo. ✅";

                // --- CORREÇÃO AQUI ---
                const roleId = process.env.MEMBRO_REGISTADO_ROLE_ID;
                // --- FIM DA CORREÇÃO ---
                
                const member = interaction.member as GuildMember;
                if (roleId) {
                    await member.roles.add(roleId);
                }

                const existingUser = await prisma.usuario.findUnique({
                    where: { id_discord: id_discord }
                });

                let referralCode = existingUser?.referral_code;

                if (existingUser && !referralCode) {
                    referralCode = await generateUniqueReferralCode(existingUser.nome);
                    await prisma.usuario.update({
                        where: { id_discord: id_discord },
                        data: { referral_code: referralCode }
                    });
                    Logger.info(CONTEXT, `Código de indicação gerado para o utilizador existente: ${id_discord}`);
                    
                    dmMessage = `Parece que você já estava registado, mas faltava-lhe um Código de Indicador.\n\n**Gerei um novo código para si.**\n\n` +
                                `Se um amigo o usar numa compra acima de R$ 10,00 (e você também tiver bilhetes nessa rifa), você ganha um bilhete grátis (máximo de 5 por rifa)!`;
                    respostaPublica = "Já estava registado! ✅ Enviei os detalhes (incluindo o seu código de indicador) para a sua DM.";
                }

                const dmEmbed = new EmbedBuilder()
                    .setTitle("ℹ️ Informação de Registo")
                    .setDescription(dmMessage)
                    .setColor("Blue")
                    .setTimestamp();
                
                try {
                    await interaction.user.send({ embeds: [dmEmbed] });
                    if (referralCode) {
                        await interaction.user.send(referralCode);
                    }
                    await interaction.editReply(respostaPublica);
                } catch (dmError) {
                    Logger.warn(CONTEXT, `Falha ao enviar DM de "duplicado" para ${id_discord}.`, dmError);
                    
                    const replyContent = `Parece que você já estava registado!\n` +
                        `**Não consegui enviar os detalhes por DM!** (As suas DMs podem estar privadas).\n\n` +
                        `O seu Código de Indicador é (toque para copiar):\n` +
                        `\`\`\`${referralCode || 'Erro ao obter'}\`\`\``;
                        
                    await interaction.editReply({ content: replyContent });
                }

            } catch (roleError) {
                Logger.error(CONTEXT, `Erro ao tentar corrigir um utilizador duplicado ${id_discord}`, roleError);
                await interaction.editReply('Parece que você já está registado, mas não consegui atualizar o seu cargo. Contacte um admin.');
            }
        } else {
            Logger.error(CONTEXT, `Erro ao guardar no DB ou adicionar função para ${id_discord}`, err);
            await interaction.editReply('Ocorreu um erro ao finalizar o seu registo. 😢 Tente novamente ou contacte um admin.');
        }
    }
}