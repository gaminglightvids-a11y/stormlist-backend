const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Simple in-memory database
const users = {};

// === CREATE SUBSCRIPTION ===
app.post('/api/create-subscription', async (req, res) => {
  try {
    const { email, paymentMethodId, name, country } = req.body;

    // Create or get customer
    let customer = await stripe.customers.create({
      email: email,
      payment_method: paymentMethodId,
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
      metadata: {
        name: name,
        country: country,
      },
    });

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [
        {
          price: process.env.STRIPE_PRICE_ID,
        },
      ],
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
    });

    // Store user data
    users[email] = {
      customerId: customer.id,
      subscriptionId: subscription.id,
      isPremium: true,
      startDate: new Date(),
      status: subscription.status,
    };

    res.json({
      success: true,
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
    });
  } catch (error) {
    console.error('Subscription error:', error);
    res.status(400).json({ error: error.message });
  }
});

// === CANCEL SUBSCRIPTION ===
app.post('/api/cancel-subscription', async (req, res) => {
  try {
    const { email } = req.body;
    const user = users[email];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const subscription = await stripe.subscriptions.del(user.subscriptionId);

    users[email].isPremium = false;
    users[email].status = 'canceled';

    res.json({
      success: true,
      message: 'Subscription canceled',
      canceledAt: new Date(),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// === GET SUBSCRIPTION STATUS ===
app.get('/api/subscription-status/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const user = users[email];

    if (!user) {
      return res.json({ isPremium: false });
    }

    const subscription = await stripe.subscriptions.retrieve(user.subscriptionId);

    res.json({
      isPremium: subscription.status === 'active',
      status: subscription.status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      nextPaymentDate: new Date(subscription.current_period_end * 1000),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// === WEBHOOK HANDLER ===
app.post('/api/webhooks/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle events
  switch (event.type) {
    case 'customer.subscription.updated':
      console.log('Subscription updated:', event.data.object);
      break;

    case 'customer.subscription.deleted':
      console.log('Subscription deleted:', event.data.object);
      break;

    case 'invoice.payment_succeeded':
      console.log('Payment succeeded:', event.data.object);
      break;

    case 'invoice.payment_failed':
      console.log('Payment failed:', event.data.object);
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({received: true});
});

// === HEALTH CHECK ===
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 StormList backend running on port ${PORT}`);
});