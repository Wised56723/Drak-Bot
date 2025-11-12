// Importa o módulo sqlite3
const sqlite3 = require('sqlite3').verbose();

// Define o nome do arquivo do banco de dados
const DB_FILE = './drak.db';

// SQL para criar a Tabela 1: Usuarios (Sem mudança)
const CREATE_TABLE_USUARIOS = `
    CREATE TABLE IF NOT EXISTS Usuarios (
        id_discord TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE
    );
`;

// SQL para criar a Tabela 2: Rifas (Sem mudança)
const CREATE_TABLE_RIFAS = `
    CREATE TABLE IF NOT EXISTS Rifas (
        id_rifa INTEGER PRIMARY KEY AUTOINCREMENT,
        nome_premio TEXT NOT NULL,
        total_bilhetes INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'ativa'
    );
`;

// SQL para criar a Tabela 3: Compras (NOVA TABELA)
// Esta tabela armazena o "lote" ou "operação de compra".
// É esta tabela que você usará para os reembolsos.
// SQL para criar a Tabela 3: Compras (MODIFICADA)
const CREATE_TABLE_COMPRAS = `
    CREATE TABLE IF NOT EXISTS Compras (
        id_compra INTEGER PRIMARY KEY AUTOINCREMENT,
        id_rifa_fk INTEGER NOT NULL,
        id_usuario_fk TEXT NOT NULL,
        data_compra DATETIME NOT NULL,
        quantidade INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'em_analise', 
        FOREIGN KEY (id_rifa_fk) REFERENCES Rifas (id_rifa),
        FOREIGN KEY (id_usuario_fk) REFERENCES Usuarios (id_discord)
    );
`;

// SQL para criar a Tabela 4: Bilhetes (MODIFICADA)
// Agora ela é mais simples. Ela apenas "liga" um número de bilhete a uma compra.
const CREATE_TABLE_BILHETES = `
    CREATE TABLE IF NOT EXISTS Bilhetes (
        id_bilhete INTEGER PRIMARY KEY AUTOINCREMENT,
        id_compra_fk INTEGER NOT NULL,
        numero_bilhete TEXT NOT NULL,
        FOREIGN KEY (id_compra_fk) REFERENCES Compras (id_compra) ON DELETE CASCADE
    );
`;
// ON DELETE CASCADE: Se uma 'Compra' for deletada, todos os bilhetes
// com o id_compra_fk correspondente serão deletados automaticamente.

// Conecta ao banco de dados e cria as tabelas
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error("Erro ao conectar ao DB:", err.message);
        throw err;
    }
    console.log('Conectado ao banco de dados drak.db.');
    
    // db.serialize() garante que os comandos SQL rodem um após o outro, em ordem
    db.serialize(() => {
        // A ordem é importante por causa das FOREIGN KEYs
        
        // 1. Cria tabela Usuarios
        db.run(CREATE_TABLE_USUARIOS, (err) => {
            if (err) console.error("Erro ao criar tabela Usuarios:", err.message);
            else console.log("Tabela 'Usuarios' verificada/criada.");
        });
        
        // 2. Cria tabela Rifas
        db.run(CREATE_TABLE_RIFAS, (err) => {
            if (err) console.error("Erro ao criar tabela Rifas:", err.message);
            else console.log("Tabela 'Rifas' verificada/criada.");
        });

        // 3. Cria tabela Compras (nova)
        db.run(CREATE_TABLE_COMPRAS, (err) => {
            if (err) console.error("Erro ao criar tabela Compras:", err.message);
            else console.log("Tabela 'Compras' verificada/criada.");
        });

        // 4. Cria tabela Bilhetes (modificada)
        db.run(CREATE_TABLE_BILHETES, (err) => {
            if (err) console.error("Erro ao criar tabela Bilhetes:", err.message);
            else console.log("Tabela 'Bilhetes' verificada/criada.");
        });
    });
});

// Exporta o objeto 'db' para que outros arquivos possam usá-lo
module.exports = db;