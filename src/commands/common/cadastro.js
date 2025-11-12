const db = require('../database.js');

// NOVO: Uma expressão regular simples para validar o formato do email
// Não é perfeita, mas é um ótimo "Nível 1"
const emailRegex = /\S+@\S+\.\S+/;

module.exports = {
    name: 'cadastro',
    description: 'Cadastra um novo usuário. Uso: !cadastro <email> <seu nome completo>',
    
    execute(message, args) {
        
        // 1. VERIFICAR E COLETAR OS DADOS
        const id_discord = message.author.id;
        const [email, ...nomeArray] = args;
        const nome = nomeArray.join(' ');

        // Verificação de erro de uso
        if (!email || nomeArray.length === 0) {
            return message.reply('Formato incorreto! Use: `!cadastro <email> <seu nome completo>`');
        }

        // NOVO: Verificação de formato de email (Nível 1)
        if (!emailRegex.test(email)) {
            return message.reply('Esse email não parece válido. Por favor, verifique o formato (ex: nome@email.com).');
        }

        // 2. PREPARAR O COMANDO SQL (Seguro contra SQL Injection)
        const sql = `INSERT OR IGNORE INTO Usuarios (id_discord, nome, email) VALUES (?, ?, ?)`;
        const params = [id_discord, nome, email];

        // 3. EXECUTAR O COMANDO NO BANCO DE DADOS
        db.run(sql, params, function(err) {
            if (err) {
                console.error(err.message);
                return message.reply('Ocorreu um erro ao tentar te cadastrar. 😢');
            }

            // this.changes nos diz se uma nova linha foi realmente inserida
            if (this.changes === 0) {
                // Se 0, o 'OR IGNORE' foi ativado, o que significa que o usuário já existe
                // (ou pelo id_discord ou pelo email, que definimos como UNIQUE)
                return message.reply('Você já está cadastrado no sistema!');
            } else {
                return message.reply(`Bem-vindo, ${nome}! Seu cadastro foi concluído com sucesso. 🎉`);
            }
        });
    }
};