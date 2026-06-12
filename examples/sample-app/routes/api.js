'use strict';

const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/public', (_req, res) => {
  res.json({ message: 'public route' });
});

router.get('/users/:id', authMiddleware, (req, res) => {
  const id = Number(req.params.id);

  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  if (id < 1) {
    return res.status(404).json({ error: 'user not found' });
  }

  res.json({ id, name: `User ${id}` });
});

router.post('/orders', authMiddleware, (req, res) => {
  const items = req.body?.items;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required' });
  }

  res.status(201).json({ orderId: 'ord_demo', items: items.length });
});

module.exports = router;
