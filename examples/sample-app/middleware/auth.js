'use strict';

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing token' });
  }

  const token = header.slice('Bearer '.length);

  if (token !== 'dev') {
    return res.status(403).json({ error: 'invalid token' });
  }

  next();
}

module.exports = {
  authMiddleware,
};
