/**
 * AvatarLive — Serveur de paiement Stripe
 * Gère les abonnements mensuel et annuel
 * Port : 4000 (ou PORT dans .env)
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

const PLANS = {
  free: {
    name: 'Gratuit', price: 0,
    features: ['1 avatar', 'Pilotage vocal basique', 'Switch manuel'],
  },
  pro_monthly: {
    name: 'Pro Mensuel', price: 999, currency: 'eur', interval: 'month',
    features: ['4 avatars', 'Voix IA avancée', 'Switch automatique', 'Contrôle mobile'],
  },
  pro_annual: {
    name: 'Pro Annuel', price: 7999, currency: 'eur', interval: 'year',
    features: ['Tout le plan Pro', '2 mois offerts', 'Support prioritaire'],
  },
};

app.get('/plans', (req, res) => res.json({ plans: PLANS }));

app.get('/status', (req, res) => res.json({
  status: 'running',
  port: process.env.PORT || 4000,
  mode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'live' : 'test',
}));

app.post('/create-checkout', async (req, res) => {
  const { plan, email } = req.body;
  if (!plan || plan === 'free') return res.json({ url: null, plan: 'free' });
  const planData = PLANS[plan];
  if (!planData) return res.status(400).json({ error: 'Plan invalide' });
  try {
    const product = await stripe.products.create({
      name: `AvatarLive ${planData.name}`,
      description: planData.features.join(', '),
    });
    const price = await stripe.prices.create({
      product: product.id, unit_amount: planData.price,
      currency: planData.currency, recurring: { interval: planData.interval },
    });
    const origin = req.headers.origin || 'http://localhost:4000';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', payment_method_types: ['card'],
      customer_email: email || undefined,
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel`, locale: 'fr',
    });
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[Stripe] Erreur create-checkout :', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/verify/:sessionId', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    res.json({
      status: subscription.status,
      plan: subscription.items.data[0].price.recurring.interval === 'month' ? 'pro_monthly' : 'pro_annual',
      email: session.customer_email,
      current_period_end: new Date(subscription.current_period_end * 1000).toLocaleDateString('fr-FR'),
    });
  } catch (err) {
    console.error('[Stripe] Erreur verify :', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/cancel-subscription', async (req, res) => {
  const { subscriptionId } = req.body;
  if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId requis' });
  try {
    const subscription = await stripe.subscriptions.cancel(subscriptionId);
    res.json({ status: subscription.status });
  } catch (err) {
    console.error('[Stripe] Erreur annulation :', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = parseInt(process.env.PORT || '4000');
app.listen(PORT, () => {
  const mode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'LIVE' : 'TEST';
  console.log('='.repeat(42));
  console.log('  AvatarLive — Serveur Stripe');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Mode : ${mode}`);
  console.log('='.repeat(42));
  for (const [key, p] of Object.entries(PLANS)) {
    const label = p.price === 0 ? 'gratuit' : `${(p.price / 100).toFixed(2)} €/${p.interval === 'month' ? 'mois' : 'an'}`;
    console.log(`  - ${key.padEnd(14)} ${label}`);
  }
  console.log('='.repeat(42));
});
