# Generates Myntra-API-Coverage.pdf — full Myntra Seller API V4 catalog vs what the OMS
# has integrated, by API family, in the style of Flipkart-API-Coverage.pdf.
# Statuses: HAVE (working) / BLOCKED (Myntra-side fault, needs their fix) /
# MISSING (not built our side, optional) / N/A (doesn't apply). Items we cover another
# way (token refresh -> re-issue, async inventory -> sync) are deliberately omitted.
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether,
)

OUT = "Myntra-API-Coverage.pdf"
DATE = "24 June 2026"

NAVY = colors.HexColor("#1B3A8F")
INK = colors.HexColor("#1A1A1A")
BODY = colors.HexColor("#3F4754")
MUTE = colors.HexColor("#6B7280")
LINE = colors.HexColor("#E5E7EB")
ALT = colors.HexColor("#F6F7F9")

ST = {
    "HAVE":    (colors.HexColor("#E2F2E7"), colors.HexColor("#137333")),
    "BLOCKED": (colors.HexColor("#FBE3E0"), colors.HexColor("#C5221F")),
    "MISSING": (colors.HexColor("#FCEFC7"), colors.HexColor("#B45309")),
    "N/A":     (colors.HexColor("#EFF0F1"), colors.HexColor("#5F6368")),
}

s = getSampleStyleSheet()
TITLE = ParagraphStyle("T", parent=s["Title"], textColor=INK, fontSize=19, leading=23, alignment=1, spaceAfter=3)
SUB = ParagraphStyle("S", parent=s["Normal"], textColor=MUTE, fontSize=8.8, leading=12, alignment=1)
MODEL = ParagraphStyle("M", parent=s["Normal"], textColor=BODY, fontSize=8.6, leading=12, alignment=0,
                       backColor=colors.HexColor("#F2F6FF"), borderColor=colors.HexColor("#C9D8F5"),
                       borderWidth=0.6, borderPadding=6, spaceBefore=4)
LEG = ParagraphStyle("L", parent=s["Normal"], fontSize=8.6, leading=12, alignment=1, textColor=INK)
SECT = ParagraphStyle("SE", parent=s["Heading2"], textColor=NAVY, fontSize=12, leading=15, spaceBefore=12, spaceAfter=5)
HEADW = ParagraphStyle("HW", parent=s["Normal"], fontName="Helvetica-Bold", fontSize=8.2, leading=10.5, textColor=colors.white)
HEADC = ParagraphStyle("HC", parent=HEADW, alignment=1)
MONO = ParagraphStyle("MO", parent=s["Normal"], fontName="Courier", fontSize=7.4, leading=9.6, textColor=colors.HexColor("#243B53"))
FAM = ParagraphStyle("FA", parent=s["Normal"], fontName="Helvetica-Bold", fontSize=8.6, leading=11, textColor=INK)
PUR = ParagraphStyle("PU", parent=s["Normal"], fontSize=8, leading=10.4, textColor=BODY)
NUMC = ParagraphStyle("NU", parent=s["Normal"], fontSize=8.4, leading=11, alignment=1, textColor=INK)
NOTE = ParagraphStyle("NO", parent=s["Normal"], fontSize=8, leading=11.5, textColor=BODY, spaceAfter=4, leftIndent=10)
HL = ParagraphStyle("HL", parent=s["Normal"], fontSize=8.2, leading=11.5, textColor=colors.HexColor("#555B66"), spaceBefore=3, fontName="Helvetica-Oblique")
FOOT = ParagraphStyle("FO", parent=s["Normal"], fontSize=7.4, leading=10, textColor=MUTE)


def badge(st):
    _bg, fg = ST[st]
    return Paragraph(f'<font color="{fg.hexval()}"><b>{st}</b></font>',
                     ParagraphStyle("B", parent=s["Normal"], fontSize=8, leading=10, alignment=1))


def styled(data, widths, status_col, status_rows):
    t = Table(data, colWidths=widths, repeatRows=1)
    ts = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
    ]
    for i, stv in enumerate(status_rows, start=1):
        if i % 2 == 0:
            ts.append(("BACKGROUND", (0, i), (status_col - 1, i), ALT))
        bg, _fg = ST[stv]
        ts.append(("BACKGROUND", (status_col, i), (status_col, i), bg))
    t.setStyle(TableStyle(ts))
    return t


def endpoint_table(title, rows):
    data = [[Paragraph("Endpoint", HEADW), Paragraph("Method", HEADC), Paragraph("Purpose", HEADW), Paragraph("Status", HEADC)]]
    for ep, m, pur, st in rows:
        data.append([Paragraph(ep, MONO), Paragraph(m, NUMC), Paragraph(pur, PUR), badge(st)])
    t = styled(data, [2.9*inch, 0.6*inch, 2.85*inch, 0.95*inch], 3, [r[3] for r in rows])
    return KeepTogether([Paragraph(title, SECT), t])


story = []
story.append(Paragraph("Myntra API Coverage Analysis", TITLE))
story.append(Paragraph(
    "Myntra OMS &mdash; Seller API V4: the full catalog Myntra serves vs. what the OMS has integrated, scoped to our "
    f"fulfilment model. Catalog from Myntra's Seller API V4 Integration Guide &amp; observed behaviour ({DATE}).", SUB))
story.append(Spacer(1, 5))
story.append(Paragraph(
    "<b>Our fulfilment model:</b> PPMP (Partner Platform Marketplace) &mdash; we list &amp; pack our own stock; "
    "Myntra's own logistics picks up and delivers. So Accept/Reject (Omni-only) and any self-delivery / own-courier "
    "tracking do not apply &mdash; orders flow RFR &gt; WP &gt; Ready-to-Dispatch, then Myntra ships.", MODEL))
story.append(Spacer(1, 7))
story.append(Paragraph(
    '<font color="#137333"><b>HAVE</b></font> integrated &amp; working &nbsp;&nbsp; '
    '<font color="#C5221F"><b>BLOCKED</b></font> Myntra-side fault &mdash; needs Myntra to fix/enable &nbsp;&nbsp; '
    '<font color="#B45309"><b>MISSING</b></font> not built our side (optional) &nbsp;&nbsp; '
    '<font color="#5F6368"><b>N/A</b></font> doesn\'t apply to us', LEG))
story.append(Spacer(1, 3))
story.append(HRFlowable(width="100%", thickness=1, color=LINE))

# 1. Coverage summary
story.append(Paragraph("1&nbsp;&nbsp; Coverage summary by API family (scoped to our model)", SECT))
sum_rows = [
    ("Authentication", "1", "1", "0", "0", "HAVE"),
    ("Orders &mdash; read", "3", "3", "0", "0", "HAVE"),
    ("Order fulfilment", "3", "2", "1", "0", "BLOCKED"),
    ("Documents", "3", "3", "0", "0", "HAVE"),
    ("Inventory", "2", "1", "1", "0", "BLOCKED"),
    ("Returns", "2", "1", "1", "0", "HAVE"),
    ("Pricing (Discount)", "1", "1", "0", "0", "HAVE"),
    ("Payments", "1", "0", "1", "0", "BLOCKED"),
    ("Other financial", "3", "0", "0", "3", "MISSING"),
    ("Inbound webhooks", "3", "3", "0", "0", "HAVE"),
]
sdata = [[Paragraph("API family (Myntra v4)", HEADW), Paragraph("Serve", HEADC), Paragraph("Have", HEADC),
          Paragraph("Blocked", HEADC), Paragraph("Gap", HEADC), Paragraph("Status", HEADC)]]
for fam, serve, have, blk, gap, st in sum_rows:
    sdata.append([Paragraph(fam, FAM), Paragraph(serve, NUMC), Paragraph(have, NUMC),
                  Paragraph(blk, NUMC), Paragraph(gap, NUMC), badge(st)])
story.append(styled(sdata, [2.55*inch, 0.68*inch, 0.68*inch, 0.85*inch, 0.62*inch, 1.02*inch], 5, [r[5] for r in sum_rows]))
story.append(Paragraph(
    "Headline: the core order lifecycle (search &gt; detail &gt; Ready-to-Dispatch &gt; label/invoice) and the inbound "
    "webhooks are fully covered. Everything not green is either <b>Myntra-side, awaiting their fix</b> "
    "(Ready-to-Ship, live-stock read, returns query, payments scope &mdash; nothing for us to build) or three optional "
    "financial endpoints we simply haven't built (credit notes, store status, OTP).", HL))

story.append(endpoint_table("2&nbsp;&nbsp; Authentication &amp; Orders &mdash; read", [
    ("POST /authorization/generate_token", "POST", "Generate access token (JWT in response header); re-issued on expiry", "HAVE"),
    ("GET /partner/v4/order/getOrderList", "GET", "Order search &mdash; status &amp; date filters, paginated", "HAVE"),
    ("GET /partner/v4/order/{sellerOrderId}", "GET", "Full order detail (items, charges, settlement, timeline)", "HAVE"),
    ("GET /partner/v4/packet/{packetId}", "GET", "Order / packet lookup by packet id", "HAVE"),
]))

story.append(endpoint_table("3&nbsp;&nbsp; Fulfilment &amp; Documents", [
    ("PUT /partner/v4/order/readyToDispatch", "PUT", "Ready to Dispatch &mdash; packs &amp; generates packet/label/invoice", "HAVE"),
    ("PUT /partner/v4/order/{id}/cancelItems", "PUT", "Cancel order line(s) with a reason", "HAVE"),
    ("PUT /partner/v4/trackingNumber/{tn}/readyToShip", "PUT", "Built &amp; wired, but Myntra returns HTTP 500 account-wide &mdash; Myntra-side fault, needs their fix", "BLOCKED"),
    ("PUT /partner/v4/order/{id}/{accept|reject}", "PUT", "Accept / Reject &mdash; Omni-only; doesn't apply to PPMP", "N/A"),
    ("GET /partner/v4/packet/{packetId}/shippingLabel", "GET", "Shipping label (PDF)", "HAVE"),
    ("GET /partner/v4/packet/{packetId}/getDocument", "GET", "Invoice document (PDF)", "HAVE"),
    ("GET /partner/v4/packet/{packetId}/getInvoiceDetails", "GET", "Invoice / tax details (JSON)", "HAVE"),
]))

story.append(endpoint_table("4&nbsp;&nbsp; Inventory, Returns &amp; Pricing", [
    ("PUT /partner/v4/inventory/update", "PUT", "Update stock per SKU (&lt;= 10/call)", "HAVE"),
    ("POST /partner/v4/inventory/search", "POST", "Built &amp; wired, but Myntra returns no stock for our SKUs &mdash; Myntra-side, needs their fix", "BLOCKED"),
    ("POST /partner/v4/returns/returnRecon", "POST", "Built, but Myntra returns 500 / empty &mdash; Myntra-side. Returns still arrive via the webhook, so no impact", "BLOCKED"),
    ("(webhook) Myntra &gt; OMS returns push", "PUSH", "Inbound customer + courier/RTO returns &mdash; the working source of returns", "HAVE"),
    ("PUT /partner/v4/discount/override", "PUT", "Set flat-percent / rupee-off discount per SKU, date-ranged", "HAVE"),
]))

story.append(endpoint_table("5&nbsp;&nbsp; Payments, financial &amp; webhooks", [
    ("Payments / settlement history", "GET", "Myntra hasn't enabled the payments scope for this merchant (403) &mdash; needs Myntra to enable; not an OMS gap", "BLOCKED"),
    ("Credit Notes", "GET", "Credit-note documents &mdash; not built our side (optional)", "MISSING"),
    ("Store Status", "GET", "Seller store on/off status &mdash; not built our side (optional)", "MISSING"),
    ("OTP", "POST", "OTP services &mdash; not built our side (optional)", "MISSING"),
    ("(webhook) /storefront/v4/order", "PUSH", "New-order push &mdash; surfaced in the Inbox", "HAVE"),
    ("(webhook) itemCancellation", "PUSH", "Order-cancellation push (verified live)", "HAVE"),
]))

# Worth building
story.append(Paragraph("6&nbsp;&nbsp; What's actually worth building", SECT))
for b in [
    "<b>On Myntra to fix &mdash; not our work:</b> the only blockers are all Myntra-side &mdash; Ready-to-Ship (HTTP 500), "
    "the returns query (500 / empty), the live-stock read (empty) and the payments scope (403). Each needs Myntra to fix "
    "the server error or enable the scope; there is nothing for us to build. Raised via Myntra support.",
    "<b>Then &mdash; payments reconciliation:</b> once Myntra enables the payments scope, automate payout reconciliation. "
    "Today the settlement amount is read per-order from the order detail; there is no payout history.",
    "<b>Optional, our side:</b> credit notes, store status and OTP endpoints &mdash; build only if a workflow needs them.",
    "<b>Already covered another way (not gaps, left out):</b> token refresh (we re-issue a fresh token on expiry) and "
    "bulk/async inventory (the sync endpoint handles our scale) &mdash; both reach the same result, so they aren't listed. "
    "Accept/Reject doesn't apply to PPMP.",
]:
    story.append(Paragraph(b, NOTE, bulletText="•"))

story.append(Spacer(1, 8))
story.append(HRFlowable(width="100%", thickness=0.5, color=LINE))
story.append(Spacer(1, 3))
story.append(Paragraph(
    "Sources: Myntra Seller API V4 Integration Guide (myntradeveloper.md) &mdash; Priority 1/2/3 families &mdash; and "
    "observed live behaviour. 'Have' / 'Blocked' / 'N/A' reflect the OMS codebase (src/services/myntraClient.js) and our "
    f"PPMP + Myntra-shipped model, as of {DATE}.", FOOT))

SimpleDocTemplate(
    OUT, pagesize=letter,
    leftMargin=0.55*inch, rightMargin=0.55*inch, topMargin=0.55*inch, bottomMargin=0.5*inch,
    title="Myntra API Coverage Analysis", author="experiences.digital",
).build(story)
print("WROTE", OUT)
