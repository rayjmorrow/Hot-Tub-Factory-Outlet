# Store payment connection

The website and storefront source are in this repository and published by
`.github/workflows/deploy-pages.yml`. The browser calls the private store API
configured in `store-config.js`; that API obtains Authorize.Net hosted-payment
tokens. GitHub Pages does not execute the Node API in `backend/server.js`.

Never put a Transaction Key in `store-config.js`, browser code, or repository
files. CRM/service merchant credentials are separate from store credentials.

## Verify credentials through GitHub

The **Check store payment connection** workflow runs the regression checks and
Authorize.Net's `authenticateTestRequest`. It never creates or charges a
transaction. It reads these repository Actions secrets:

- `AUTHORIZE_API_LOGIN_ID`
- `AUTHORIZE_TRANSACTION_KEY`

Legacy `AUTHORIZENET_` aliases are supported. If both names are configured,
their values must agree; the code fails explicitly instead of silently choosing
between conflicting accounts or keys. Leading/trailing whitespace is trimmed.

An authentication pass proves those GitHub secrets work with Authorize.Net.
It does not prove a separately deployed API uses the same values. Activation
requires configuring the intended private runtime and verifying its checkout
response as well.

## Remove an unwanted API host

Changing the hostname alone is insufficient. Before publishing a replacement:

1. Deploy this API on an owner-approved private Node runtime with the correct
   store credentials and existing account/fulfillment signing secrets.
2. Verify a hosted payment token, tax, catalog pricing, custom covers, and
   existing AutoShip/account behavior. Do not submit a real charge to verify
   credentials.
3. Update `store-config.js` to the verified replacement URL, and update gateway
   webhooks and service callbacks to match.
4. Verify the published cart opens the Authorize.Net card-entry form.

Keep the current connection explicit until a verified replacement is ready.
No replacement host is provisioned or implied by this code repair.
