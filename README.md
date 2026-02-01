npm install

ngrok http 3000 pour recevoir les pushs d'helius (mise a jour balance/historique)

npm run dev

services :

- coingeko -> afficher le prix du sol en USD
- redis -> systeme de cache
- mongodb -> db -> trois documents :
  - User -> infos users
  - magiclinks -> stocke le token pour vérifier que le lien est bien correcte
  - webhookshelius -> stocke l'id du webhook pour mettre a jour en temps réel les infos users

- socket.io -> service de socket qui relais les infos au frontend quand il en recoit (webhook helius).
- magiclink -> envoie un lien unique a l'user pour vérifier son mail
- helius -> fetch les infos users en temps réel


middleware:
  - gestion session turnkey -> a chaque appel on check si le jwt est bien signé par turnkey + expiration + on extrait le suborgid et on check si le user existe en db
  - on check les entres lors de la connexion
  - preAuth -> system de jwt direct gere par Stealf 