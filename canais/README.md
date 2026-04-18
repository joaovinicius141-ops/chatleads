# canais/

Cada arquivo aqui implementa um canal de entrada/saida para o bot
(Messenger, WhatsApp, Instagram, etc).

## Contrato que cada canal deve implementar

```js
module.exports = {
  nome: "messenger",            // identificador do canal
  enviarTexto(userId, texto),   // async -> boolean
  enviarArquivo(userId, caminho, nomeArquivo), // async -> boolean
  registrarWebhook(app),        // registra as rotas Express do canal
};
```

## Como adicionar um novo canal (ex: WhatsApp)

1. Crie `canais/whatsapp.js` exportando o contrato acima
2. Importe em `index.js`: `const whatsapp = require("./canais/whatsapp")`
3. Registre o webhook: `whatsapp.registrarWebhook(app)`
4. No ponto de recebimento de mensagem, chame `processarComTimeout(userId, texto, canal)`

A logica de negocio (Gemini, setores, pagamento) ja e agnostica ao canal —
so precisa passar o objeto `canal` com os metodos de envio.

## Canais disponiveis

- `messenger.js` — Facebook Messenger via Graph API
- `whatsapp.js` — (a implementar — estrutura pronta)
