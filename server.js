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

  const limit = req.query.limit || '30';
  const offset = req.query.offset || '0';

  const params = new URLSearchParams({
    sort: 'date_created',
    criteria: 'desc',
    limit,
    offset,
  });

  try {
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await mpRes.json();

    if (!mpRes.ok) {
      return res.status(mpRes.status).json({ error: 'Erro ao consultar pagamentos', detalhes: data });
    }

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mercadopago/preference', async (req, res) => {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'MERCADOPAGO_ACCESS_TOKEN não configurado' });
  }

  const { titulo, valor, external_reference, payer_email } = req.body;

  if (!titulo || typeof valor !== 'number' || valor <= 0) {
    return res.status(400).json({ error: 'titulo e valor (número > 0) são obrigatórios' });
  }

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
  };

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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`VideoManager rodando na porta ${PORT}`);
});
