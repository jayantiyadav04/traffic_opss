const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const service = require('../services/paymentService');
const router = express.Router();
const adapter = req => req.app.locals.paymentAdapter;
router.post('/webhooks/paypal', async (req, res, next) => {
    try { res.status(200).json(await service.receiveWebhook({ headers: req.headers, rawBody: req.rawBody, adapter: adapter(req) })); } catch (error) { next(error); }
});
router.use(protect);
router.get('/config', (req, res) => res.json(service.config(adapter(req))));
router.post('/orders', async (req, res, next) => {
    try { const data = await service.createOrder({ actor: req.user, key: req.get('Idempotency-Key'), body: req.body, adapter: adapter(req), requestId: req.requestId }); res.status(data.payment.status === 'pending' && !data.payment.provider_order_id ? 202 : data.created ? 201 : 200).json(data); } catch (error) { next(error); }
});
router.post('/orders/:orderId/capture', async (req, res, next) => {
    try { const data = await service.captureOrder({ actor: req.user, key: req.get('Idempotency-Key'), orderId: req.params.orderId, body: req.body, adapter: adapter(req), requestId: req.requestId }); res.status(data.payment.status === 'pending' ? 202 : 200).json(data); } catch (error) { next(error); }
});
router.get('/:id', async (req, res, next) => {
    try { res.json(await service.getPayment({ id: req.params.id, actor: req.user })); } catch (error) { next(error); }
});
router.post('/:id/reconcile', async (req, res, next) => {
    try { res.json(await service.getPayment({ id: req.params.id, actor: req.user, adapter: adapter(req), reconcile: true, requestId: req.requestId })); } catch (error) { next(error); }
});
module.exports = router;
