# Educonnect

Plataforma de gestão educacional do Projeto Integrador. Este repositório implementa os fluxos centrais das Sprints 2 e 4 sobre a base Next.js, Node.js e Firebase.

## Stack

- Web: Next.js App Router, React e TypeScript.
- API: Node.js, Express e TypeScript.
- Dados: Cloud Firestore, acessado pelo Firebase Admin na API.
- Identidade: Firebase Authentication com e-mail e senha.
- QR Code: `qrcode` no servidor; leitura pela câmera com `html5-qrcode`.
- Pacote `@educonnect/shared`: tipos de turma, aula, frequência e perfil.

## Iniciar localmente

1. Use Node.js 22 ou superior.
2. Configure um projeto Firebase, habilite o provedor de e-mail/senha no Authentication e crie o banco Firestore.
3. Copie `.env.example` para `apps/web/.env.local` e `apps/api/.env`. Configure as variáveis `NEXT_PUBLIC_*` apenas na web. Na API, configure `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT` (JSON da conta de serviço ou o mesmo conteúdo codificado em Base64), `QR_TOKEN_SECRET` (segredo aleatório com pelo menos 32 caracteres) e `WEB_ORIGIN`. Em hosts como Render, cole o JSON ou seu valor Base64 em `FIREBASE_SERVICE_ACCOUNT`; não configure um caminho local em `GOOGLE_APPLICATION_CREDENTIALS`.
4. Configure uma conta inicial de Coordenação no Firebase Authentication e crie seu documento `users/{uid}` (veja o modelo de dados abaixo). Esse bootstrap inicial é feito no Console; depois a Coordenação pode cadastrar professores e estudantes pela tela de Gestão escolar.
5. Execute `npm install` e `npm run dev` na raiz. Web: `http://localhost:3000`; API: `http://localhost:4000`.

O login usa persistência por aba (`session`), permitindo contas diferentes em abas distintas do mesmo navegador. A sessão continua após recarregar a aba e termina quando ela é fechada.

O navegador só libera câmera e localização em HTTPS ou em `localhost`. Não use uma chave privada Firebase no frontend. O arquivo de credenciais Admin deve ficar fora do controle de versão.

### Publicação na Vercel e no Render

- Na Vercel, defina `NEXT_PUBLIC_API_URL` como `https://educonnect-q6a8.onrender.com/api` (o frontend também acrescenta `/api` se o sufixo for omitido).
- No Render, defina `WEB_ORIGIN` com o domínio HTTPS do frontend na Vercel, sem caminho. Para permitir mais de uma origem, separe os domínios por vírgula; use o domínio estável de produção e, quando necessário, o endereço de preview atual.
- Depois de mudar variáveis, faça novo deploy dos serviços correspondentes. `NEXT_PUBLIC_API_URL` é incorporada durante o build do frontend.

## Banco de dados

O modelo, campos, relacionamentos, índices, regras, ciclo de frequência e a transição dos documentos antigos estão detalhados em [docs/firestore-model.md](docs/firestore-model.md). O banco usa `schemaVersion: 1`; datas são Firestore Timestamps e os vínculos de turma são normalizados em `class_memberships`.

Antes de aplicar a migração opcional, confira a prévia sem gravação:

```sh
npm --workspace @educonnect/api run db:migrate:check
```

Ela apenas lê os dados existentes e informa as quantidades que migraria. A migração foi aplicada ao projeto Firebase configurado; não havia documentos antigos para converter. O comando de aplicação é `npm --workspace @educonnect/api run db:migrate:apply`.

As regras atuais negam acesso direto do navegador ao Firestore. Os índices compostos do painel foram publicados no projeto configurado. Publique as regras com Firebase CLI após revisar o projeto de destino:

```sh
firebase deploy --only firestore
```

O Firebase Admin ignora as regras Firestore; a API valida token, colégio, perfil e vínculo de turma em cada rota protegida.

## Sprints implementadas

**Sprint 2 — Frequência digital**

- Professor inicia uma chamada presencial e escolhe turma e disciplina.
- O QR é assinado no servidor e cada token vale 10 segundos. Na renovação, tokens já exibidos continuam válidos até o próprio vencimento.
- O estudante lê o QR com a câmera e a API confere turma, chamada ativa e geocerca da sala. A API não armazena a coordenada exata do estudante.
- A chamada registra presenças em transações Firestore, impede duplicidade, atualiza a lista a cada 5 segundos e permite correção manual com histórico de auditoria.
- Ao encerrar, estudantes sem registro ficam com falta. Falta justificada pode ser marcada manualmente durante a chamada.

**Sprint 4 — Gestão e acompanhamento**

- Painel do professor e coordenação com frequências e turmas alimentadas pelo Firestore.
- Tela da turma com lista, busca, frequência individual, faltas e chamada em andamento.
- Monitoramento de aulas abertas, atualizado a cada 10 segundos.
- Alertas da coordenação para estudantes com frequência abaixo de 75% e pelo menos cinco aulas registradas nos últimos 30 dias.
- Cadastro de turmas com disciplinas e geocerca; criação de perfis de professor/estudante no Firebase Authentication e vínculo com turmas.
- Protocolos pedagógicos ficam disponíveis na conta do estudante; o envio de e-mail/notificação externa ainda não está integrado.
- Estudante consulta histórico de frequência e seus protocolos.

Os agregados são calculados a partir dos registros de frequência, sem um sistema de eventos ou notificação externo. As telas e o painel de acompanhamento seguem o Figma, com atualização periódica pela API.

## Rotas principais

- `GET /api/health`, `GET /api/me`, `GET /api/dashboard/summary`
- `GET /api/classes`, `POST /api/classes`, `POST /api/classes/:classId/members`
- `GET /api/classes/:classId/overview`, `GET /api/classes/:classId/roster`
- `POST /api/lessons`, `POST /api/lessons/:lessonId/qr`, `GET /api/lessons/:lessonId/roster`
- `PATCH /api/lessons/:lessonId/attendance/:studentId`, `POST /api/lessons/:lessonId/close`
- `POST /api/attendance/scan`, `GET /api/attendance/me`
- `GET /api/dashboard/monitoring`, `GET /api/dashboard/alerts`
- `GET /api/users`, `POST /api/users`, `GET /api/protocols`, `POST /api/protocols`

## Fora destas sprints

Notificações automáticas aos responsáveis, exportação de relatórios, devolutivas de atividades, Roblox, desafios e PIBITS ficam para os próximos incrementos. Os protocolos são gravados e aparecem ao estudante, mas ainda não disparam notificações fora da plataforma.
