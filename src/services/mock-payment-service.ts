import express from 'express';

const app = express();
app.use(express.json());

app.post('/execute', (req, res) => {
  const { verb, target, context } = req.body;
  console.log(`[Mock Payment] Executing ${verb} ${target}`, context);
  // Simulate success
  res.json({
    transactionId: `txn_${Date.now()}`,
    status: 'approved',
    amount: context.amount || 100,
  });
});

const port = 3001;
app.listen(port, () => console.log(`💳 Mock payment service listening on port ${port}`));