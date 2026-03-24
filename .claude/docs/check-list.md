1/ no rate limiting on API routes
> anyone can spam your backend into a $500 bill overnight

2/ auth tokens stored in localStorage
> one XSS attack = every single user account compromised

3/ no input sanitisation on forms
> SQL injection still works in 2026. your AI didnt tell you that.

4/ hardcoded API keys in the frontend
> someone WILL find them within 48 hours of launch

5/ stripe webhooks with no signature verification
> anyone can fake a successful payment event

6/ no database indexing on queried fields
> works fine at 100 users. completely dies at 1,000.

7/ no error boundaries in the UI
> one crash = white screen = user never comes back

8/ sessions that never expire
> stolen token = permanent access to that account. forever.

9/ no pagination on database queries
> one fetch loads your entire database into memory

10/ password reset links that dont expire
> old email in someones inbox = instant account takeover

11/ no environment variable validation at startup
> app silently breaks in production with zero error message

12/ images uploaded directly to your server
> no CDN = 8 second load times + massive hosting bill

13/ no CORS policy
> any website on the internet can make requests to your API

14/ emails sent synchronously in request handlers
> one slow SMTP server = your entire app hangs

15/ no database connection pooling
> first traffic spike = database crashes

16/ admin routes with no role checks
> any logged in user can access your admin panel

17/ no health check endpoint
> your app goes down silently. you find out from a client.

18/ no logging in production
> when something breaks you have zero idea where or why

19/ no backup strategy on your database
> one bad migration = all your user data. gone.

20/ no TypeScript on AI generated code
> AI writes confident, wrong, untyped code and you ship it anyway