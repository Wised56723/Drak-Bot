import { 
    ApplicationCommandType, 
    ApplicationCommandOptionType,
    PermissionFlagsBits,
    TextChannel,
    EmbedBuilder
} from "discord.js";
import { Command } from "../../structs/types/Command";
import db = require("../../database.js");
import { RunResult } from "sqlite3";
import { updateRaffleMessage, countBilhetesVendidos } from "../../utils/RaffleEmbed"; // countBilhetesVendidos foi movido para cá

// Define a interface para o objeto Compra (TypeScript)
interface Compra {
    id_compra: number;
    id_rifa_fk: number;
    id_usuario_fk: string;
    quantidade: number;
    status: string;
    data_compra: string; // Adicionado para 'listar'
}

// Define a interface para o objeto Rifa (mínimo)
interface Rifa {
    id_rifa: number;
    total_bilhetes: number;
}

// Função para gerar os números dos bilhetes (ex: "001", "002")
function gerarNumerosBilhetes(totalBilhetesRifa: number, inicio: number, quantidade: number) {
    const padding = String(totalBilhetesRifa - 1).length;
    
    const numeros: string[] = [];
    for (let i = 0; i < quantidade; i++) {
        const numero = (inicio + i + 1);
        numeros.push(String(numero).padStart(padding, '0'));
    }
    return numeros;
}

export default new Command({
    name: "gestao",
    description: "Gerencia compras e pagamentos.",
    type: ApplicationCommandType.ChatInput,
    dmPermission: false,
    defaultMemberPermissions: PermissionFlagsBits.Administrator,

    options: [
        {
            name: "aprovar",
            description: "Aprova uma compra 'em_analise' e gera os bilhetes.",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "id_compra",
                    description: "O ID da compra (ex: 1, 2, 3)",
                    type: ApplicationCommandOptionType.Integer,
                    required: true
                }
            ]
        },
        // NOVO SUB-COMANDO 'REJEITAR'
        {
            name: "rejeitar",
            description: "Rejeita uma compra 'em_analise'.",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "id_compra",
                    description: "O ID da compra a ser rejeitada.",
                    type: ApplicationCommandOptionType.Integer,
                    required: true
                },
                {
                    name: "motivo",
                    description: "O motivo da rejeição (será enviado ao usuário).",
                    type: ApplicationCommandOptionType.String,
                    required: true
                }
            ]
        },
        // NOVO SUB-COMANDO 'LISTAR'
        {
            name: "listar",
            description: "Lista todas as compras pendentes (em análise).",
            type: ApplicationCommandOptionType.Subcommand,
        }
    ],

    // Roteador de sub-comandos
    async run({ client, interaction, options }) {

        const subcomando = options.getSubcommand();

        // --- LÓGICA DE APROVAR (Existente) ---
        if (subcomando === "aprovar") {
            await interaction.deferReply({ ephemeral: true });
            
            const id_compra = options.getInteger("id_compra", true);

            db.serialize(async () => {
                try {
                    await new Promise<void>((resolve, reject) => 
                        db.run("BEGIN TRANSACTION", (err) => err ? reject(err) : resolve())
                    );

                    const compra: Compra = await new Promise((resolve, reject) => {
                        db.get("SELECT * FROM Compras WHERE id_compra = ?", 
                            [id_compra], 
                            (err, row: Compra) => err ? reject(err) : resolve(row)
                        );
                    });

                    if (!compra) throw new Error("Compra não encontrada.");
                    if (compra.status !== 'em_analise') {
                        throw new Error(`Esta compra já está com status '${compra.status}'.`);
                    }

                    const rifa: Rifa = await new Promise((resolve, reject) => {
                        db.get("SELECT id_rifa, total_bilhetes FROM Rifas WHERE id_rifa = ?", 
                            [compra.id_rifa_fk], 
                            (err, row: Rifa) => err ? reject(err) : resolve(row)
                        );
                    });

                    const vendidos = await countBilhetesVendidos(compra.id_rifa_fk);
                    
                    if (vendidos + compra.quantidade > rifa.total_bilhetes) {
                        throw new Error(`Esta compra excede o total de bilhetes da rifa! (${vendidos} já vendidos + ${compra.quantidade} da compra > ${rifa.total_bilhetes} total)`);
                    }

                    await new Promise<void>((resolve, reject) => {
                        db.run("UPDATE Compras SET status = 'aprovada' WHERE id_compra = ?", 
                            [id_compra], 
                            (err) => err ? reject(err) : resolve()
                        );
                    });

                    const novosNumeros = gerarNumerosBilhetes(rifa.total_bilhetes, vendidos, compra.quantidade);
                    
                    const stmt = db.prepare("INSERT INTO Bilhetes (id_compra_fk, numero_bilhete) VALUES (?, ?)");
                    for (const numero of novosNumeros) {
                        await new Promise<void>((resolve, reject) => 
                            stmt.run([id_compra, numero], (err) => err ? reject(err) : resolve())
                        );
                    }
                    await new Promise<void>((resolve, reject) => 
                        stmt.finalize((err) => err ? reject(err) : resolve())
                    );

                    await new Promise<void>((resolve, reject) => 
                        db.run("COMMIT", (err) => err ? reject(err) : resolve())
                    );
                    
                    await interaction.editReply(
                        `✅ Compra #${id_compra} aprovada!\n` +
                        `**Usuário:** <@${compra.id_usuario_fk}>\n` +
                        `**Quantidade:** ${compra.quantidade}\n` +
                        `**Bilhetes Gerados:** ${novosNumeros.join(', ')}`
                    );

                    try {
                        const user = await client.users.fetch(compra.id_usuario_fk);
                        const dmEmbed = new EmbedBuilder()
                            .setTitle(`✅ Compra Aprovada (Rifa #${compra.id_rifa_fk})`)
                            .setDescription(`Sua compra de **${compra.quantidade} bilhete(s)** foi aprovada!`)
                            .addFields({ name: "Seus Números da Sorte", value: `\`\`\`${novosNumeros.join(', ')}\`\`\`` })
                            .setColor("Green")
                            .setTimestamp();
                        await user.send({ embeds: [dmEmbed] });
                    } catch (dmError) {
                        console.error("Erro ao enviar DM:", dmError);
                        await interaction.followUp({
                            content: `Aviso: Não foi possível enviar a DM de confirmação para o usuário <@${compra.id_usuario_fk}>.`,
                            ephemeral: true
                        });
                    }

                    await updateRaffleMessage(client, compra.id_rifa_fk);

                } catch (error: any) {
                    await new Promise<void>((resolve, reject) => 
                        db.run("ROLLBACK", (err) => err ? reject(err) : resolve())
                    );
                    console.error("[ERRO GESTÃO]:", error.message);
                    await interaction.editReply(`❌ Erro ao aprovar: ${error.message}`);
                }
            });
        }
        
        // --- NOVA LÓGICA DE REJEITAR ---
        else if (subcomando === "rejeitar") {
            await interaction.deferReply({ ephemeral: true });

            const id_compra = options.getInteger("id_compra", true);
            const motivo = options.getString("motivo", true);

            try {
                // 1. Buscar a compra
                const compra: Compra = await new Promise((resolve, reject) => {
                    db.get("SELECT * FROM Compras WHERE id_compra = ?", 
                        [id_compra], 
                        (err, row: Compra) => err ? reject(err) : resolve(row)
                    );
                });

                if (!compra) {
                    throw new Error("Compra não encontrada.");
                }
                if (compra.status !== 'em_analise') {
                    throw new Error(`Esta compra não está 'em_analise' (Status atual: '${compra.status}').`);
                }

                // 2. Atualizar o status para 'rejeitada'
                await new Promise<void>((resolve, reject) => {
                    db.run("UPDATE Compras SET status = 'rejeitada' WHERE id_compra = ?", 
                        [id_compra], 
                        (err) => err ? reject(err) : resolve()
                    );
                });

                // 3. Enviar DM para o Usuário
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
                    console.error("Erro ao enviar DM de rejeição:", dmError);
                }

                // 4. Responder ao Admin
                await interaction.editReply(
                    `⛔ Compra #${id_compra} rejeitada com sucesso.\n` +
                    `O usuário <@${compra.id_usuario_fk}> foi notificado.`
                );

            } catch (error: any) {
                console.error("[ERRO GESTÃO REJEITAR]:", error.message);
                await interaction.editReply(`❌ Erro ao rejeitar: ${error.message}`);
            }
        }
        
        // --- NOVA LÓGICA DE LISTAR ---
        else if (subcomando === "listar") {
            await interaction.deferReply({ ephemeral: true });

            try {
                // Busca todas as compras 'em_analise'
                const compras: Compra[] = await new Promise((resolve, reject) => {
                    const sql = `
                        SELECT c.*, u.nome as nome_usuario, r.nome_premio 
                        FROM Compras c
                        JOIN Usuarios u ON c.id_usuario_fk = u.id_discord
                        JOIN Rifas r ON c.id_rifa_fk = r.id_rifa
                        WHERE c.status = 'em_analise'
                        ORDER BY c.data_compra ASC
                    `;
                    db.all(sql, [], (err, rows: Compra[]) => err ? reject(err) : resolve(rows));
                });

                if (compras.length === 0) {
                    return interaction.editReply("Não há nenhuma compra pendente no momento.");
                }

                const embed = new EmbedBuilder()
                    .setTitle("Compras Pendentes (Em Análise)")
                    .setColor("Orange")
                    .setTimestamp();
                
                let description = "Use `/gestao aprovar id_compra: [ID]` para aprovar.\n\n";
                
                // Agrupa as compras para o embed
                compras.forEach((compra: any) => {
                    const data = new Date(compra.data_compra).toLocaleString('pt-BR');
                    description += 
                        `**ID: \`${compra.id_compra}\`** - Rifa: \`#${compra.id_rifa_fk}\` (${compra.nome_premio})\n` +
                        `> **Usuário:** ${compra.nome_usuario} (<@${compra.id_usuario_fk}>)\n` +
                        `> **Qtd:** ${compra.quantidade} | **Data:** ${data}\n\n`;
                });

                // O Discord tem limite de 4096 caracteres para descrição
                if (description.length > 4096) {
                    description = description.substring(0, 4090) + "\n... (lista muito longa)";
                }

                embed.setDescription(description);
                
                await interaction.editReply({ embeds: [embed] });

            } catch (error: any) {
                console.error("[ERRO GESTÃO LISTAR]:", error.message);
                await interaction.editReply(`❌ Erro ao listar compras: ${error.message}`);
            }
        }
    },
});