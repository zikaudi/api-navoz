const express = require("express");
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: "10mb" }));

// Log middleware para todas as requisições
app.use((req, res, next) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`📥 [${new Date().toISOString()}] REQ ${requestId} | ${req.method} ${req.path} | IP: ${req.ip}`);
  
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - startTime;
    console.log(`📤 [${new Date().toISOString()}] RES ${requestId} | Status: ${res.statusCode} | Tempo: ${duration}ms`);
    originalEnd.apply(res, args);
  };
  
  next();
});

/* ============================
   CONEXÃO POSTGRESQL (NEON)
============================ */
console.log("🔧 Conectando ao PostgreSQL (Neon)...");

// Configuração da conexão com Neon
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_k7qNOyB0urGC@ep-rapid-term-acnp3e9v-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=verify-full',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Função para converter valores como "1.3k" para número
function parseNumericValue(value) {
  if (!value || value === '0') return 0;
  
  const str = String(value).toLowerCase().trim();
  
  // Remove caracteres não numéricos (exceto ponto decimal e k/m)
  let clean = str.replace(/[^0-9.kmsm]/g, '');
  
  // Converte notações abreviadas
  if (clean.includes('k')) {
    return parseFloat(clean.replace('k', '')) * 1000;
  } else if (clean.includes('m')) {
    return parseFloat(clean.replace('m', '')) * 1000000;
  } else if (clean.includes('s')) {
    return parseFloat(clean.replace('s', '')) * 1000000; // 's' também pode significar milhões
  }
  
  // Tenta converter para número
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

// Função para criar a tabela se não existir (versão corrigida)
async function createTable() {
  const client = await pool.connect();
  try {
    // Verificar se a tabela já existe
    const checkTableQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'ranking'
      );
    `;
    
    const tableExists = await client.query(checkTableQuery);
    
    if (!tableExists.rows[0].exists) {
      console.log('📋 Criando tabela ranking...');
      
      const createTableQuery = `
        CREATE TABLE ranking (
          id SERIAL PRIMARY KEY,
          nome VARCHAR(255) UNIQUE NOT NULL,
          posicao INTEGER,
          doacao_total VARCHAR(50) DEFAULT '0',
          doacao_semanal VARCHAR(50) DEFAULT '0',
          contribuicao_total VARCHAR(50) DEFAULT '0',
          contribuicao_semanal VARCHAR(50) DEFAULT '0',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      
      await client.query(createTableQuery);
      console.log('✅ Tabela "ranking" criada com sucesso');
      
      // Criar índices
      const createIndexesQuery = `
        CREATE INDEX idx_ranking_nome ON ranking(nome);
        CREATE INDEX idx_ranking_doacao ON ranking(
          CASE 
            WHEN doacao_total ~ '^[0-9.]+[kms]?$' THEN 
              CASE 
                WHEN doacao_total LIKE '%k' THEN CAST(REPLACE(doacao_total, 'k', '') AS FLOAT) * 1000
                WHEN doacao_total LIKE '%m' THEN CAST(REPLACE(doacao_total, 'm', '') AS FLOAT) * 1000000
                WHEN doacao_total LIKE '%s' THEN CAST(REPLACE(doacao_total, 's', '') AS FLOAT) * 1000000
                ELSE CAST(doacao_total AS FLOAT)
              END
            ELSE 0
          END DESC
        );
      `;
      
      await client.query(createIndexesQuery);
      console.log('✅ Índices criados com sucesso');
    } else {
      console.log('ℹ️  Tabela "ranking" já existe');
    }
  } catch (error) {
    console.error('❌ Erro ao verificar/criar tabela:', error.message);
  } finally {
    client.release();
  }
}

// Testar conexão e configurar tabela
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erro na conexão com o banco de dados:', err.stack);
  } else {
    console.log('✅ Conexão com PostgreSQL estabelecida com sucesso');
    release();
    
    // Criar tabela se não existir
    createTable();
  }
});

/* ============================
   PARSER DOAÇÃO
============================ */
function parsePayload(payload) {
  console.log("🔍 Iniciando parser do payload de doação...");
  
  const lista = [];
  let itensParseados = 0;

  for (let n = 7; n <= 14; n++) {
    const nome = payload[`com.wejoy.weplay.us:id/name_tv$${n}`];
    const total = payload[`com.wejoy.weplay.us:id/total_active_tv$${n - 5}`];
    const semanal = payload[`com.wejoy.weplay.us:id/week_active_tv$${n - 4}`];

    if (!nome) {
      console.log(`   ⏩ Posição ${n-6}: Nome não encontrado, pulando...`);
      continue;
    }

    lista.push({
      nome: nome.trim(),
      posicao: n - 6,
      doacao_total: total || "0",
      doacao_semanal: semanal || "0"
    });
    
    itensParseados++;
    console.log(`   ✅ Posição ${n-6}: ${nome.trim()} | Total: ${total || "0"} | Semanal: ${semanal || "0"}`);
  }

  console.log(`📊 Parser de doação concluído: ${itensParseados} itens processados`);
  return lista;
}

/* ============================
   PARSER CONTRIBUIÇÃO
============================ */
function parsePayloadContribuicao(payload) {
  console.log("🔍 Iniciando parser do payload de contribuição...");
  
  const lista = [];
  let itensParseados = 0;

  for (let n = 7; n <= 14; n++) {
    const nome = payload[`com.wejoy.weplay.us:id/name_tv$${n}`];
    const total = payload[`com.wejoy.weplay.us:id/total_active_tv$${n - 5}`];
    const semanal = payload[`com.wejoy.weplay.us:id/week_active_tv$${n - 4}`];

    if (!nome) {
      console.log(`   ⏩ Posição ${n-6}: Nome não encontrado, pulando...`);
      continue;
    }

    lista.push({
      nome: nome.trim(),
      contribuicao_total: total || "0",
      contribuicao_semanal: semanal || "0"
    });
    
    itensParseados++;
    console.log(`   ✅ Posição ${n-6}: ${nome.trim()} | Contribuição Total: ${total || "0"} | Semanal: ${semanal || "0"}`);
  }

  console.log(`📊 Parser de contribuição concluído: ${itensParseados} itens processados`);
  return lista;
}

/* ============================
   POST /payload (DOAÇÃO)
============================ */
app.post("/payload", async (req, res) => {
  console.log("💰 Processando payload de doação...");
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const dados = parsePayload(req.body);
    console.log(`📥 Recebido ${dados.length} registros para processar`);

    let criados = 0;
    let atualizados = 0;
    let erros = 0;

    for (const [index, item] of dados.entries()) {
      try {
        console.log(`   🔄 Processando ${index + 1}/${dados.length}: ${item.nome}...`);
        
        // Verificar se existe
        const checkQuery = 'SELECT id FROM ranking WHERE nome = $1';
        const checkResult = await client.query(checkQuery, [item.nome]);

        if (checkResult.rows.length > 0) {
          // Atualizar
          const updateQuery = `
            UPDATE ranking 
            SET posicao = $1, 
                doacao_total = $2, 
                doacao_semanal = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE nome = $4
          `;
          await client.query(updateQuery, [
            item.posicao,
            item.doacao_total,
            item.doacao_semanal,
            item.nome
          ]);
          atualizados++;
          console.log(`      ✅ ${item.nome} - ATUALIZADO (posição ${item.posicao})`);
        } else {
          // Inserir novo
          const insertQuery = `
            INSERT INTO ranking (nome, posicao, doacao_total, doacao_semanal)
            VALUES ($1, $2, $3, $4)
          `;
          await client.query(insertQuery, [
            item.nome,
            item.posicao,
            item.doacao_total,
            item.doacao_semanal
          ]);
          criados++;
          console.log(`      🆕 ${item.nome} - CRIADO (posição ${item.posicao})`);
        }
      } catch (error) {
        erros++;
        console.error(`      ❌ Erro ao processar ${item.nome}:`, error.message);
      }
    }

    await client.query('COMMIT');
    console.log(`🎯 Resultado doação: ${criados} criados, ${atualizados} atualizados, ${erros} erros`);

    res.json({
      success: true,
      criados,
      atualizados,
      erros,
      total_processado: dados.length
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("💥 ERRO CRÍTICO no endpoint /payload:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    client.release();
  }
});

/* ============================
   POST /contribuicao
============================ */
app.post("/contribuicao", async (req, res) => {
  console.log("🎯 Processando payload de contribuição...");
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const dados = parsePayloadContribuicao(req.body);
    console.log(`📥 Recebido ${dados.length} registros para processar`);

    let atualizados = 0;
    let ignorados = 0;
    let erros = 0;

    for (const [index, item] of dados.entries()) {
      try {
        console.log(`   🔄 Processando ${index + 1}/${dados.length}: ${item.nome}...`);
        
        // Verificar se existe
        const checkQuery = 'SELECT id FROM ranking WHERE nome = $1';
        const checkResult = await client.query(checkQuery, [item.nome]);

        if (checkResult.rows.length === 0) {
          ignorados++;
          console.log(`      ⏩ ${item.nome} - IGNORADO (não encontrado no banco)`);
          continue;
        }

        // Atualizar SOMENTE contribuição
        const updateQuery = `
          UPDATE ranking 
          SET contribuicao_total = $1, 
              contribuicao_semanal = $2,
              updated_at = CURRENT_TIMESTAMP
          WHERE nome = $3
        `;
        await client.query(updateQuery, [
          item.contribuicao_total,
          item.contribuicao_semanal,
          item.nome
        ]);

        atualizados++;
        console.log(`      ✅ ${item.nome} - CONTRIBUIÇÃO ATUALIZADA`);
      } catch (error) {
        erros++;
        console.error(`      ❌ Erro ao processar ${item.nome}:`, error.message);
      }
    }

    await client.query('COMMIT');
    console.log(`🎯 Resultado contribuição: ${atualizados} atualizados, ${ignorados} ignorados, ${erros} erros`);

    res.json({
      success: true,
      atualizados,
      ignorados,
      erros,
      total_processado: dados.length
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("💥 ERRO CRÍTICO no endpoint /contribuicao:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    client.release();
  }
});

/* ============================
   GET /dados - CORRIGIDO PARA LIDAR COM VALORES "1.3k"
============================ */
app.use(cors());

app.get("/dados", async (req, res) => {
  console.log("📊 Solicitando dados do ranking...");
  
  try {
    console.log("   🔍 Buscando registros no banco de dados...");
    
    // Buscar todos os registros
    const query = `
      SELECT nome, 
             posicao,
             doacao_total, 
             doacao_semanal, 
             contribuicao_total, 
             contribuicao_semanal,
             created_at,
             updated_at
      FROM ranking 
      ORDER BY posicao ASC
    `;
    
    const result = await pool.query(query);
    const registros = result.rows;

    console.log(`   ✅ Encontrados ${registros.length} registros`);
    
    // Ordenar localmente usando a função parseNumericValue
    const registrosOrdenados = [...registros].sort((a, b) => {
      const valorA = parseNumericValue(a.doacao_total);
      const valorB = parseNumericValue(b.doacao_total);
      return valorB - valorA; // Descendente
    });
    
    // Log do top 5
    if (registrosOrdenados.length > 0) {
      console.log("   🏆 TOP 5 DOAÇÕES:");
      registrosOrdenados.slice(0, 5).forEach((u, i) => {
        console.log(`      ${i + 1}. ${u.nome} - Total: ${u.doacao_total}, Semanal: ${u.doacao_semanal}`);
      });
    }

    res.json({
      total_usuarios: registrosOrdenados.length,
      usuarios: registrosOrdenados.map(u => ({
        nome: u.nome,
        posicao: u.posicao,
        doacao_total: u.doacao_total,
        doacao_semanal: u.doacao_semanal,
        contribuicao_total: u.contribuicao_total,
        contribuicao_semanal: u.contribuicao_semanal
      }))
    });

  } catch (error) {
    console.error("💥 ERRO CRÍTICO no endpoint /dados:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* ============================
   POST /zerar-banco
============================ */
app.post("/zerar-banco", async (req, res) => {
  console.log("⚠️  SOLICITADA OPERAÇÃO DE ZERAR BANCO DE DADOS!");
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log("   📊 Contando registros atuais...");
    const countResult = await client.query('SELECT COUNT(*) FROM ranking');
    const total = parseInt(countResult.rows[0].count);
    
    console.log(`   🔍 Total de registros encontrados: ${total}`);

    if (total > 0) {
      console.log("   🗑️  Iniciando remoção de registros...");
      await client.query('DELETE FROM ranking');
      
      // Reiniciar a sequência do ID
      await client.query('ALTER SEQUENCE IF EXISTS ranking_id_seq RESTART WITH 1');
      
      console.log(`✅ Banco zerado com sucesso (${total} registros removidos)`);
    } else {
      console.log("ℹ️  Banco já está vazio, nenhum registro removido");
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      mensagem: "Banco de dados zerado com sucesso",
      registros_removidos: total
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ ERRO CRÍTICO ao zerar banco:");
    console.error("   Detalhes:", err.message);
    console.error("   Stack:", err.stack);

    res.status(500).json({
      success: false,
      error: "Erro ao zerar banco",
      detalhes: err.message
    });
  } finally {
    client.release();
  }
});

/* ============================
   ENDPOINT DE STATUS
============================ */
app.get("/status", async (req, res) => {
  console.log("🔍 Verificando status da aplicação...");
  
  try {
    const countResult = await pool.query('SELECT COUNT(*) FROM ranking');
    const totalUsuarios = parseInt(countResult.rows[0].count);
    
    const health = {
      status: "online",
      timestamp: new Date().toISOString(),
      database: "postgresql-neon",
      total_usuarios: totalUsuarios,
      memoria: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
      uptime: `${process.uptime().toFixed(2)} segundos`
    };

    console.log(`   ✅ Status OK - Usuários: ${totalUsuarios}, Memória: ${health.memoria}`);
    
    res.json(health);
  } catch (error) {
    console.error("❌ Erro no status:", error);
    res.status(500).json({
      status: "error",
      error: error.message
    });
  }
});

/* ============================
   MIDDLEWARE DE ERRO
============================ */
app.use((err, req, res, next) => {
  console.error("🔥 ERRO NÃO TRATADO:");
  console.error("   Path:", req.path);
  console.error("   Método:", req.method);
  console.error("   Erro:", err.message);
  console.error("   Stack:", err.stack);

  res.status(500).json({
    success: false,
    error: "Erro interno do servidor",
    timestamp: new Date().toISOString()
  });
});

/* ============================
   START SERVER
============================ */
const startServer = async () => {
  try {
    console.log("🚀 Iniciando API de Ranking com PostgreSQL...");
    console.log("=".repeat(50));
    
    // Verificar e criar tabela se necessário
    await createTable();
    
    // Verifica dados iniciais
    const countResult = await pool.query('SELECT COUNT(*) FROM ranking');
    const total = parseInt(countResult.rows[0].count);
    console.log(`📊 Registros iniciais no banco: ${total}`);
    
    app.listen(3000, () => {
      console.log("=".repeat(50));
      console.log("🎉 API RODANDO COM SUCESSO!");
      console.log("📍 URL: http://localhost:3000");
      console.log("🗄️  Banco: PostgreSQL (Neon)");
      console.log("📝 Endpoints disponíveis:");
      console.log("   POST   /payload        - Processar doações");
      console.log("   POST   /contribuicao   - Processar contribuições");
      console.log("   GET    /dados          - Obter ranking completo");
      console.log("   POST   /zerar-banco    - Limpar banco de dados");
      console.log("   GET    /status         - Status da aplicação");
      console.log("=".repeat(50));
      console.log("📢 Logs ativados. Monitorando operações...");
    });
  } catch (error) {
    console.error("💥 FALHA NA INICIALIZAÇÃO DA API:");
    console.error(error);
    process.exit(1);
  }
};

startServer();

/* ============================
   TRATAMENTO DE ENCERRAMENTO
============================ */
process.on('SIGINT', async () => {
  console.log('🛑 Encerrando conexões com o banco...');
  await pool.end();
  console.log('✅ Conexões encerradas. Servidor finalizado.');
  process.exit(0);
});