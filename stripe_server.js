/**
 * AvatarLive — Serveur de paiement Stripe
 * Gère les abonnements mensuel et annuel
 * Port : 4000
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// PLANS — modifie les prix ici directement
// ─────────────────────────────────────────────
const PLANS = {
  free: {
    name: 'Gratuit',
    price: 0,
    features: ['1 avatar', 'Pilotage vocal basique', 'Switch manuel'],
  },
  pro_monthly: {
    name: 'Pro Mensuel',
    price: 999, // en centimes = 9,99€
    currency: 'eur',
    interval: 'month',
    features: ['4 avatars', 'Voix IA avancée', 'Switch automatique', 'Contrôle mobile'],
  },
  pro_annual: {
    name: 'Pro Annuel',
    price: 7999, // en centimes = 79,99€
    currency: 'eur',
    interval: 'year',
    features: ['Tout le plan Pro', '2 mois offerts', 'Support prioritaire'],
  },
};

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

// Récupère les plans disponibles
app.get('/plans', (req, res) => {
  res.json({ plans: PLANS });
});

// Crée une session de paiement Stripe Checkout
app.post('/create-checkout', async (req, res) => {
  const { plan, email } = req.body;

  if (!plan || plan === 'free') {
    return res.json({ url: null, plan: 'free' });
  }

  const planData = PLANS[plan];
  if (!planData) {
    return res.status(400).json({ error: 'Plan invalide' });
  }

  try {
    // Crée ou récupère le produit Stripe
    const product = await stripe.products.create({
      name: 'AvatarLive ' + planData.name,
      description: planData.features.join(', '),
    });

    // Crée le prix
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: planData.price,
      currency: planData.currency,
      recurring: { interval: planData.interval },
    });

    // Crée la session Checkout
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email || undefined,
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${req.headers.origin || 'http://localhost:4000'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'http://localhost:4000'}/cancel`,
      locale: 'fr',
    });

    res.json({ url: session.url, sessionId: session.id });

  } catch (err) {
    console.error('[Stripe] Erreur :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Vérifie le statut d'un abonnement après paiement
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
    res.status(500).json({ error: err.message });
  }
});

// Annule un abonnement
app.post('/cancel-subscription', async (req, res) => {
  const { subscriptionId } = req.body;
  try {
    const subscription = await stripe.subscriptions.cancel(subscriptionId);
    res.json({ status: subscription.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Status du serveur
app.get('/status', (req, res) => {
  res.json({ status: 'running', port: process.env.PORT || 4000, mode: 'test' });
});

// ─────────────────────────────────────────────
// DÉMARRAGE
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log('='.repeat(40));
  console.log('  AvatarLive — Serveur Stripe');
  console.log(`  Port : http://localhost:${PORT}`);
  console.log('  Mode : TEST (aucun vrai paiement)');
  console.log('='.repeat(40));
  console.log('  Plans disponibles :');
  Object.entries(PLANS).forEach(([key, p]) => {
    console.log(`  - ${key} : ${p.price / 100}€`);
  });
  console.log('='.repeat(40));
});
