/**
 * Order-summary email (not a legal receipt).
 * Sent via Gmail SMTP using Firebase secrets.
 */

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(amount) {
  return `PHP ${Number(amount || 0).toLocaleString('en-PH')}`;
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function buildOrderSummaryEmail(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const rows = items.map((item) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;">
        <strong>${esc(item.name)}</strong><br>
        <span style="color:#666;font-size:13px;">SKU ${esc(item.sku)} · ${esc(item.sizeCm)} · Qty ${esc(item.quantity)}</span>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">
        ${esc(formatMoney(item.lineTotal))}
      </td>
    </tr>
  `).join('');

  const fulfillment = order.fulfillment === 'delivery' ? 'Delivery' : 'Store pickup';
  const notes = order.deliveryNotes
    ? `<p style="margin:8px 0 0;"><strong>Notes:</strong> ${esc(order.deliveryNotes)}</p>`
    : '';

  const subject = `Tile Depot order summary ${order.id ? `(${order.id})` : ''}`.trim();

  const html = `
<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f3f8;font-family:system-ui,-apple-system,sans-serif;color:#111;">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e9e6f0;">
    <div style="padding:20px 22px;background:#1600a8;color:#fff;">
      <div style="font-size:12px;letter-spacing:.12em;opacity:.85;">TILE DEPOT DISCOUNT CENTER</div>
      <h1 style="margin:6px 0 0;font-size:22px;">Order summary</h1>
    </div>
    <div style="padding:18px 22px;background:#eeeaff;color:#3a3470;font-size:13px;line-height:1.45;">
      This is an <strong>order summary only</strong> — not an official sales invoice or BIR receipt.
      Your official receipt is issued by the store POS.
    </div>
    <div style="padding:20px 22px;">
      <p style="margin:0 0 4px;color:#777;font-size:12px;">Reference</p>
      <p style="margin:0 0 14px;font-weight:700;">${esc(order.id || '—')}</p>
      <p style="margin:0 0 4px;color:#777;font-size:12px;">Customer</p>
      <p style="margin:0 0 14px;">${esc(order.customerName || 'Walk-in customer')}<br>${esc(order.customerEmail)}</p>
      <p style="margin:0 0 4px;color:#777;font-size:12px;">Fulfillment</p>
      <p style="margin:0 0 14px;">${esc(fulfillment)}${notes}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
      <div style="display:flex;justify-content:space-between;margin-top:16px;padding-top:12px;border-top:1px solid #eee;font-size:16px;">
        <span>Order total</span>
        <strong style="color:#1600a8;">${esc(formatMoney(order.subtotal))}</strong>
      </div>
      <p style="margin:18px 0 0;color:#777;font-size:12px;line-height:1.4;">
        Payment was confirmed in-store. Questions? Reply to this email or visit Tile Depot Discount Center.
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = [
    'Tile Depot Discount Center — Order summary',
    '(Not an official receipt)',
    '',
    `Reference: ${order.id || '—'}`,
    `Customer: ${order.customerName || 'Walk-in customer'} <${order.customerEmail}>`,
    `Fulfillment: ${fulfillment}`,
    order.deliveryNotes ? `Notes: ${order.deliveryNotes}` : '',
    '',
    ...items.map((item) =>
      `- ${item.name} (${item.sku}, ${item.sizeCm}) x${item.quantity} = ${formatMoney(item.lineTotal)}`
    ),
    '',
    `Order total: ${formatMoney(order.subtotal)}`,
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

module.exports = {
  isValidEmail,
  buildOrderSummaryEmail,
};
