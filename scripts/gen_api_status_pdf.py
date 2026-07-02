# Generates Myntra-API-Status.pdf — a feature-wise status of the Myntra Seller API V4
# integration, in the same business-facing style as Flipkart-API-Status.pdf.
# Statuses from live probes (24 Jun 2026) + verified prior evidence.
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether,
)

OUT = "Myntra-API-Status.pdf"
CHECKED = "24 June 2026"

NAVY = colors.HexColor("#1B3A8F")
INK = colors.HexColor("#1A1A1A")
BODY = colors.HexColor("#3F4754")
MUTE = colors.HexColor("#6B7280")
LINE = colors.HexColor("#E5E7EB")
ALT = colors.HexColor("#F6F7F9")

STATUS = {
    "WORKING": (colors.HexColor("#E2F2E7"), colors.HexColor("#137333")),
    "READY":   (colors.HexColor("#FCEFC7"), colors.HexColor("#B45309")),
    "BLOCKED": (colors.HexColor("#FBE3E0"), colors.HexColor("#C5221F")),
    "N/A":     (colors.HexColor("#EFF0F1"), colors.HexColor("#5F6368")),
}

styles = getSampleStyleSheet()
TITLE = ParagraphStyle("TITLE", parent=styles["Title"], textColor=INK, fontSize=20, leading=24, spaceAfter=3, alignment=1)
SUB = ParagraphStyle("SUB", parent=styles["Normal"], textColor=MUTE, fontSize=9.5, leading=13, alignment=1)
LEG = ParagraphStyle("LEG", parent=styles["Normal"], fontSize=8.8, leading=13, alignment=1, textColor=INK)
SECT = ParagraphStyle("SECT", parent=styles["Heading2"], textColor=NAVY, fontSize=13, leading=16, spaceBefore=13, spaceAfter=5)
HEADW = ParagraphStyle("HEADW", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8.6, leading=11, textColor=colors.white)
FEAT = ParagraphStyle("FEAT", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=11.5, textColor=INK)
DESC = ParagraphStyle("DESC", parent=styles["Normal"], fontSize=8.7, leading=11.5, textColor=BODY)
KNOW = ParagraphStyle("KNOW", parent=styles["Normal"], fontSize=9, leading=13, textColor=BODY, spaceAfter=4, leftIndent=10, bulletIndent=0)


def badge(s):
    _bg, fg = STATUS[s]
    return Paragraph(f'<font color="{fg.hexval()}"><b>{s}</b></font>',
                     ParagraphStyle("B", parent=styles["Normal"], fontSize=8.4, leading=10, alignment=1))


def section(title, rows):
    data = [[Paragraph("Feature", HEADW), Paragraph("What it does", HEADW), Paragraph("Status", ParagraphStyle("hw", parent=HEADW, alignment=1))]]
    for feat, desc, st in rows:
        data.append([Paragraph(feat, FEAT), Paragraph(desc, DESC), badge(st)])
    t = Table(data, colWidths=[1.85*inch, 4.35*inch, 1.0*inch], repeatRows=1)
    ts = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
    ]
    for i, (_f, _d, st) in enumerate(rows, start=1):
        if i % 2 == 0:
            ts.append(("BACKGROUND", (0, i), (1, i), ALT))
        bg, _fg = STATUS[st]
        ts.append(("BACKGROUND", (2, i), (2, i), bg))
    t.setStyle(TableStyle(ts))
    return KeepTogether([Paragraph(title, SECT), t])


story = []
story.append(Paragraph("Myntra Integration &mdash; Feature Status", TITLE))
story.append(Paragraph(
    f"What you can do with your Myntra store, and what's working. "
    f"Live-checked on {CHECKED} on the real Myntra account.", SUB))
story.append(Spacer(1, 7))
story.append(Paragraph(
    '<font color="#137333"><b>WORKING</b></font> live and in use &nbsp;&nbsp; '
    '<font color="#B45309"><b>READY</b></font> built, awaiting first live use &nbsp;&nbsp; '
    '<font color="#C5221F"><b>BLOCKED</b></font> Myntra-side limitation &nbsp;&nbsp; '
    '<font color="#5F6368"><b>N/A</b></font> not applicable to this account', LEG))
story.append(Spacer(1, 4))
story.append(HRFlowable(width="100%", thickness=1, color=LINE))

SECTIONS = [
    ("Connection", [
        ("Live Myntra connection",
         "Credential-based token auth that auto-refreshes; works off-network (not IP- or domain-locked).", "WORKING"),
    ]),
    ("Orders &amp; fulfilment", [
        ("View &amp; search orders",
         "Browse every order; filter by status (new, in-progress, packed, shipped, delivered, cancelled, completed) and by date.", "WORKING"),
        ("Order details",
         "Open any order for its items, customer, address, charges, settlement and timeline.", "WORKING"),
        ("Process a new order",
         "One-click Ready to Dispatch &mdash; Myntra packs it and generates the packet, shipping label and invoice.", "WORKING"),
        ("Cancel an order",
         "Cancel item(s) with a reason, live on Myntra.", "READY"),
        ("Hand to courier (Ready to Ship)",
         "Mark a packed parcel ready for courier pickup. Myntra's Ready-to-Ship API returns a server error (HTTP 500) account-wide &mdash; raised with support; removed from the flow meanwhile.", "BLOCKED"),
        ("Accept / Reject new orders",
         "Manually accept or reject incoming orders. Not used on this (PPMP) account &mdash; orders move to processing automatically.", "N/A"),
    ]),
    ("Documents", [
        ("Shipping label",
         "Download the Myntra shipping label (PDF) for any packed order.", "WORKING"),
        ("Tax invoice",
         "Download the invoice (PDF); itemised tax details are also shown in-app.", "WORKING"),
    ]),
    ("Returns", [
        ("See returns",
         "Customer and courier/RTO returns arrive automatically with reason, type and tracking. Delivered via Myntra's webhook &mdash; the working source of return data.", "WORKING"),
        ("Live return-status lookup",
         "Query a return's latest status from Myntra on demand. The returns-recon query comes back empty / errors for this account, so the webhook status is used instead.", "BLOCKED"),
    ]),
    ("Inventory", [
        ("Update stock to Myntra",
         "Push stock levels per SKU (replaces the closed M-Direct panel).", "READY"),
        ("Read live stock levels",
         "Pull current on-hand stock from Myntra. Myntra's inventory search returns no data for this account's SKUs.", "BLOCKED"),
    ]),
    ("Pricing", [
        ("Discount override",
         "Set a flat-percent / rupee-off discount per SKU for a date range.", "READY"),
    ]),
    ("Payments &amp; reporting", [
        ("Sales report",
         "360-degree report &mdash; SKU / category / region / time-series, returns and post-delivery returns; exportable to Excel.", "WORKING"),
        ("Per-order settlement",
         "The settlement amount Myntra pays you, per line, shown on every order.", "WORKING"),
        ("Payout / settlement history",
         "Full payment history from Myntra's payments API. HTTP 403 &mdash; the payments scope is not enabled for this merchant.", "BLOCKED"),
        ("Unified dashboard",
         "Myntra blended with your other channels into one set of KPIs.", "WORKING"),
    ]),
]

for title, rows in SECTIONS:
    story.append(section(title, rows))

story.append(Spacer(1, 12))
story.append(Paragraph("Things to know", SECT))
for b in [
    "<b>The BLOCKED items are all Myntra-side</b>, not OMS bugs &mdash; server errors (Ready-to-Ship, the returns query, the live-stock read) or disabled scopes (payments, M-Direct). All are raised with Myntra support.",
    "<b>Returns still work</b> &mdash; they arrive through Myntra's push webhook. Only the on-demand returns query and the live-stock read come back empty for this account, so the OMS relies on the webhook plus your order data instead.",
    "<b>READY features</b> (cancel, stock update, discount) are built end-to-end against Myntra's spec and wired into the OMS; they just haven't been fired on a real live order/SKU yet &mdash; the first one is a quick confirmation.",
]:
    story.append(Paragraph(b, KNOW, bulletText="•"))

SimpleDocTemplate(
    OUT, pagesize=letter,
    leftMargin=0.6*inch, rightMargin=0.6*inch, topMargin=0.6*inch, bottomMargin=0.55*inch,
    title="Myntra Integration - Feature Status", author="experiences.digital",
).build(story)
print("WROTE", OUT)
