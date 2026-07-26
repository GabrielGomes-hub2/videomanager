const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = '/data/db.json';

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
}

app.get('/api/data', (req, res) => {
  res.json(loadData());
});

app.post('/api/data', (req, res) => {
  try {
    saveData(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/mercadopago/saldo', async (req, res) => {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'MERCADOPAGO_ACCESS_TOKEN não configurado' });
  }

  try {
    const meRes = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await meRes.json();

    if (!meRes.ok) {
      return res.status(meRes.status).json({ error: 'Erro ao identificar conta', detalhes: me });
    }

    const saldoRes = await fetch(
      `https://api.mercadopago.com/users/${me.id}/mercadopago_account/balance`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const saldo = await saldoRes.json();

    if (!saldoRes.ok) {
      return res.status(saldoRes.status).json({ error: 'Erro ao consultar saldo', detalhes: saldo });
    }

    res.json(saldo);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/mercadopago/pagamentos', async (req, res) => {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'MERCADOPAGO_ACCESS_TOKEN não configurado' });
  }

  const { begin_date, end_date } = req.query;
  const limit = req.query.limit || '100';
  const offset = req.query.offset || '0';
  const status = req.query.status || 'approved';

  const params = new URLSearchParams({
    sort: 'date_approved',
    criteria: 'desc',
    status,
    limit,
    offset,
  });
  if (begin_date && end_date) {
    params.set('range', 'date_approved');
    params.set('begin_date', `${begin_date}T00:00:00.000-03:00`);
    params.set('end_date', `${end_date}T23:59:59.999-03:00`);
  }

  try {
    const meRes = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const me = await meRes.json();

    if (!meRes.ok) {
      return res.status(meRes.status).json({ error: 'Erro ao identificar conta', detalhes: me });
    }

    params.set('collector.id', me.id);

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await mpRes.json();

    if (!mpRes.ok) {
      return res.status(mpRes.status).json({ error: 'Erro ao consultar pagamentos', detalhes: data });
    }

    const pagamentos = (data.results || []).map((p) => ({
      id: p.id,
      data: p.date_approved || p.date_created,
      descricao: p.description || '',
      referencia: p.external_reference || '',
      valor: p.transaction_amount,
    }));
    const total = pagamentos.reduce((s, p) => s + Number(p.valor || 0), 0);

    res.json({ pagamentos, total, paging: data.paging });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mercadopago/preference', async (req, res) => {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'MERCADOPAGO_ACCESS_TOKEN não configurado' });
  }

  const {
    titulo,
    valor,
    external_reference,
    payer_email,
    permitir_pix = true,
    permitir_cartao = true,
    permitir_boleto = true,
    parcelas_max = 12,
    validade_dias,
  } = req.body;

  if (!titulo || typeof valor !== 'number' || valor <= 0) {
    return res.status(400).json({ error: 'titulo e valor (número > 0) são obrigatórios' });
  }

  const excluded_payment_types = [];
  if (!permitir_pix) excluded_payment_types.push({ id: 'bank_transfer' });
  if (!permitir_cartao) excluded_payment_types.push({ id: 'credit_card' }, { id: 'debit_card' });
  if (!permitir_boleto) excluded_payment_types.push({ id: 'ticket' });

  const body = {
    items: [
      {
        title: titulo,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: valor,
      },
    ],
    external_reference,
    payer: payer_email ? { email: payer_email } : undefined,
    payment_methods: {
      excluded_payment_types,
      installments: permitir_cartao ? Number(parcelas_max) || 1 : 1,
    },
  };

  if (validade_dias) {
    const now = new Date();
    const until = new Date(now.getTime() + Number(validade_dias) * 24 * 60 * 60 * 1000);
    body.expires = true;
    body.expiration_date_from = now.toISOString();
    body.expiration_date_to = until.toISOString();
  }

  try {
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await mpRes.json();

    if (!mpRes.ok) {
      return res.status(mpRes.status).json({ error: 'Erro ao criar preference', detalhes: data });
    }

    res.json({ id: data.id, init_point: data.init_point });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mercadopago/gerar-boleto', async (req, res) => {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'MERCADOPAGO_ACCESS_TOKEN não configurado' });
  }

  const { valor, descricao, nome, cpf, email, external_reference } = req.body;

  if (typeof valor !== 'number' || valor <= 0) {
    return res.status(400).json({ error: 'valor (número > 0) é obrigatório' });
  }
  if (!descricao || !nome || !cpf || !email) {
    return res.status(400).json({ error: 'descricao, nome, cpf e email são obrigatórios' });
  }

  const cpfLimpo = String(cpf).replace(/\D/g, '');
  const [first_name, ...resto] = String(nome).trim().split(/\s+/);
  const last_name = resto.join(' ') || first_name;

  const body = {
    payment_method_id: 'bolbradesco',
    transaction_amount: valor,
    description: descricao,
    external_reference,
    payer: {
      first_name,
      last_name,
      email,
      identification: { type: 'CPF', number: cpfLimpo },
    },
  };

  try {
    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': require('crypto').randomUUID(),
      },
      body: JSON.stringify(body),
    });
    const data = await mpRes.json();

    if (!mpRes.ok) {
      return res.status(mpRes.status).json({ error: 'Erro ao gerar boleto', detalhes: data });
    }

    res.json({
      id: data.id,
      link_boleto: data.transaction_details?.external_resource_url,
      codigo_barras: data.barcode?.content,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`VideoManager rodando na porta ${PORT}`);
});
