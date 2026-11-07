import os,re,csv,io,hmac
from flask import Flask,request,redirect,Response
import psycopg
from psycopg.rows import dict_row
app=Flask(__name__)
DB=os.getenv("DATABASE_URL","")
USER=os.getenv("ADMIN_USER","admin")
PASS=os.getenv("ADMIN_PASSWORD","")
def conn():return psycopg.connect(DB,autocommit=True,row_factory=dict_row)
def setup():
 with conn() as db:
  db.execute("""CREATE TABLE IF NOT EXISTS vip_signups(id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL, email_opt_in BOOLEAN DEFAULT FALSE, sms_opt_in BOOLEAN DEFAULT FALSE, consent_version TEXT DEFAULT '2026-11-07-v1', source TEXT DEFAULT 'Trade Show', created_at TIMESTAMPTZ DEFAULT NOW())""")
PAGE="""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Furbaby VIP</title><style>*{box-sizing:border-box}body{margin:0;background:#171019;color:white;font:16px/1.5 system-ui,-apple-system,sans-serif}main{max-width:525px;margin:18px auto;padding:15px}.panel{background:#291927;border:1px solid #78536d;border-radius:20px;padding:26px}.brand{text-align:center;letter-spacing:2px;color:#f9b2d0;font-size:13px;font-weight:800}h1{text-align:center;font-size:34px;line-height:1.2;color:#ffabd1}p{text-align:center}label{display:block;margin:13px 0 5px;font-weight:600}input.field{width:100%;font-size:18px;padding:13px;border-radius:9px;border:1px solid #ccc}.choice{display:flex;gap:12px;margin:15px 0;font-size:13px;line-height:1.5}.choice input{width:21px;height:21px;flex-shrink:0;accent-color:#e969a6}.button{display:block;width:100%;background:#ee83b6;color:#220f1e;text-decoration:none;font-size:19px;font-weight:800;text-align:center;padding:16px;border:0;border-radius:11px}.fine{font-size:12px;color:#d9c6d1;text-align:left}.hidden{position:absolute;left:-9999px}.footer{text-align:center;margin-top:18px}.footer a{color:#ffb2d5}</style></head><body><main><section class="panel"><div class="brand">FURBABY FASHIONS BY GINA</div>__CONTENT__</section><div class="footer"><a href="https://furbaby-fashions.com">Visit Furbaby Fashions</a></div></main></body></html>"""
FORM="""<h1>Join Furbaby VIP 🐾</h1><p>Thank you for visiting our booth! Register for <b>25% off one purchase</b>. Look for Furbaby Fashions discounts in your inbox soon.</p>__ERROR__<form action="/signup" method="post"><label for="name">Full name *</label><input class="field" id="name" name="name" type="text" autocomplete="name" maxlength="120" required><label for="email">Email *</label><input class="field" id="email" name="email" type="email" autocomplete="email" maxlength="254" required><label for="phone">Mobile number *</label><input class="field" id="phone" name="phone" type="tel" autocomplete="tel" maxlength="30" required><div class="hidden"><input name="website" tabindex="-1" autocomplete="off"></div><label class="choice"><input type="checkbox" name="email_opt_in" value="yes"><span>Yes, email me future Furbaby Fashions promotions and updates. I may unsubscribe anytime.</span></label><label class="choice"><input type="checkbox" name="sms_opt_in" value="yes"><span>Yes, send me occasional promotional texts from Furbaby Fashions. Consent is optional, message frequency varies, message/data rates may apply. Reply STOP to opt out. Consent is not required for the requested coupon.</span></label><p class="fine">We use your details for registration and the requested discount. Ongoing marketing requires your separate choice above.</p><button class="button" type="submit">Join Furbaby VIP</button></form>"""
THANKS="""<h1>Thank you!</h1><p>Thank you for registering for discounts. Look for Furbaby Fashions discounts in your inbox soon.</p><a class="button" href="https://furbaby-fashions.com">Visit Furbaby Fashions</a>"""
def page(content):return PAGE.replace("__CONTENT__",content)
@app.get("/")
def index():return page(FORM.replace("__ERROR__",""))
@app.post("/signup")
def signup():
 if request.form.get("website"):return page(THANKS)
 name=request.form.get("name","").strip()
 email=request.form.get("email","").strip().lower()
 phone=re.sub(r"[^0-9+]","",request.form.get("phone",""))
 if not name or len(name)>120 or not re.fullmatch(r"[^ @]+@[^ @]+\.[^ @]+",email) or not 10<=len(re.sub(r"\D","",phone))<=15:
  return page(FORM.replace("__ERROR__","<p>Please enter valid contact information.</p>")),400
 try:
  setup()
  with conn() as db:
   db.execute("INSERT INTO vip_signups(name,email,phone,email_opt_in,sms_opt_in) VALUES (%s,%s,%s,%s,%s) ON CONFLICT(email) DO NOTHING",(name,email,phone,request.form.get("email_opt_in")=="yes",request.form.get("sms_opt_in")=="yes"))
 except Exception:
  app.logger.exception("Signup failed")
  return page("<h1>Unable to save</h1><p>Please try again.</p>"),503
 return redirect("/thanks",303)
@app.get("/thanks")
def thanks():return page(THANKS)
@app.get("/health")
def health():
 try:setup();return {"status":"ok"}
 except Exception:return {"status":"unavailable"},503
@app.get("/admin/export.csv")
def export_csv():
 auth=request.authorization
 if not(PASS and auth and hmac.compare_digest(auth.username,USER) and hmac.compare_digest(auth.password,PASS)):
  return Response("Authentication required",401,{"WWW-Authenticate":'Basic realm="Furbaby VIP"'})
 setup()
 with conn() as db:rows=db.execute("SELECT name,email,phone,email_opt_in,sms_opt_in,source,created_at FROM vip_signups ORDER BY id").fetchall()
 out=io.StringIO();writer=csv.writer(out);writer.writerow(["name","email","phone","email_marketing","sms_marketing","source","created_at"])
 for r in rows:
  vals=[r["name"],r["email"],r["phone"],r["email_opt_in"],r["sms_opt_in"],r["source"],r["created_at"].isoformat()]
  writer.writerow(["'"+v if isinstance(v,str) and v.startswith(("=","+","-","@")) else v for v in vals])
 return Response(out.getvalue(),mimetype="text/csv",headers={"Content-Disposition":"attachment; filename=furbaby-vip.csv","Cache-Control":"no-store"})
