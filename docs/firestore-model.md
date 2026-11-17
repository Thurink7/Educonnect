# Modelo de dados do Firestore

## Convenções

- Todas as coleções pertencem a um colégio. Cada documento persistido pela API traz `schoolId` e `schemaVersion: 1`.
- O bootstrap inicial usa `schoolId: "default"`; outro colégio deve receber seu próprio identificador, único e estável. O identificador de colégio é uma fronteira de autorização, não um rótulo de interface.
- Datas de consulta usam Firestore `Timestamp` (UTC). A interface formata as datas para `pt-BR` e considera Fortaleza nos resumos de “hoje”.
- IDs Firebase Authentication são usados como `users/{uid}` e como `userId` nos vínculos.
- A API usa Firebase Admin, portanto as regras do Firestore não são executadas nas leituras e gravações do servidor. As rotas verificam ID token, perfil, colégio, vínculo e relação com a aula. O navegador não recebe acesso direto às coleções.

## Coleções

### `users/{uid}`

Perfil de aplicação ligado ao usuário Firebase Authentication.

| Campo | Tipo | Regra |
| --- | --- | --- |
| `schoolId` | string | Obrigatório em dados novos; define o colégio. |
| `schemaVersion` | number | `1`. |
| `displayName`, `email` | string | Nome e e-mail do perfil. |
| `role` | string | `coordination`, `teacher` ou `student`. Apenas a Coordenação cria perfis de professor/estudante pela API. |
| `registration` | string | Matrícula; obrigatória para estudante. |
| `guardian` | map | Para estudante: `name`, `email?`, `phone?`. Contato só é usado em etapas futuras de comunicação. |
| `classIds` | string[] | Índice legado/materializado para compatibilidade; `class_memberships` é o vínculo canônico. |
| `teachingAssignments` | map[] | Para professor: atribuições por turma, com `classId` e `subjects[]`; refletidas também em `class_memberships`. |
| `createdAt`, `updatedAt` | Timestamp | Auditoria básica. |

O primeiro perfil `coordination` é criado no Console Firebase. Nunca aceite `role` enviado pelo próprio cliente de login como fonte de autorização; a API lê o documento de perfil.

### `classes/{classId}`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `schoolId`, `schemaVersion` | string, number | Identidade do colégio e versão do documento. |
| `name`, `shift` | string | Nome e turno. |
| `subjects` | string[] | Disciplinas habilitadas para a turma. |
| `location` | map | Obrigatório para turma nova: `latitude`, `longitude`, `radiusMeters` (20 a 1000). É a geocerca da sala. |
| `schedule` | map[] | `weekday` (0–6), `startsAt`, `endsAt`, `subject`, `teacherId?`. Preparado para horários; chamadas atuais iniciam no momento da ação do professor. |
| `createdBy`, `createdAt`, `updatedAt` | string, Timestamp | Auditoria. |

`teacherIds` e `studentIds` são aceitos apenas como campos antigos durante a migração; documentos novos usam `class_memberships`.

### `class_memberships/{classId}_{uid}`

Relação única entre uma pessoa e uma turma. O ID determinístico evita vínculos duplicados.

Campos: `classId`, `userId`, `schoolId`, `role` (`teacher` ou `student`), `schemaVersion`, `createdAt`, `createdBy`.

### `lessons/{lessonId}`

Uma chamada por turma e disciplina. Apenas uma chamada ativa por turma.

Campos: `schoolId`, `schemaVersion`, `classId`, `subject`, `teacherId`, `mode` (`in-person` ou `remote`), `status` (`active` ou `closed`), `startsAt`, `endsAt?`, `presentCount`, `qrNonce`, `qrExpiresAt`, `createdAt`, `updatedAt`, `closedAt?`.

O QR contém apenas um token HMAC com `lessonId`, `classId`, `schoolId`, nonce aleatório e validade de dez segundos. A tela renova o código pouco antes do vencimento. Um código já exibido continua aceito até o vencimento contido em sua assinatura, mesmo após a emissão do próximo código; o token também precisa corresponder a uma aula ativa e à turma indicada. `qrNonce` e `qrExpiresAt` são estado do código mais recente, não histórico de tokens.

### `attendance/{lessonId}_{studentUid}`

Um registro atual por estudante/aula. A chave composta e uma transação impedem registros duplicados concorrentes.

Campos: `schoolId`, `schemaVersion`, `lessonId`, `classId`, `studentId`, `status` (`present`, `absent`, `justified`), `method` (`qr`, `manual`), `markedBy`, `recordedAt`, `updatedAt?`, `note?`, `location?`.

`location` guarda somente `{ verified, distanceMeters, accuracyMeters }`. Latitude e longitude recebidas do aparelho são usadas para validar a geocerca, mas não são persistidas. No fechamento da aula, estudantes sem registro recebem `status: absent` e `absenceReason: not-marked-before-close`.

### `attendance_events/{eventId}`

Histórico imutável das alterações manuais: `schoolId`, `lessonId`, `classId`, `studentId`, `previousStatus`, `newStatus`, `note?`, `changedBy`, `createdAt`, `schemaVersion`. O documento corrente de `attendance` pode mudar; o evento registra cada correção feita durante uma chamada ativa.

### `protocols/{protocolId}`

Orientação pedagógica por estudante: `schoolId`, `schemaVersion`, `classId`, `studentId`, `studentName`, `className`, `title`, `description`, `dueAt?`, `status` (`open` ou `resolved`), `createdBy`, `createdAt`, `updatedAt`, `resolvedAt?`.

O estudante consulta e conclui seus próprios protocolos. A gravação não envia e-mail, SMS ou notificação push.

## Relações

```text
users ──< class_memberships >── classes ──< lessons ──< attendance >── users
                                           │                 │
                                           └── attendance_events
classes ──< protocols >── users
```

`attendance` é o livro de frequência. Os percentuais da interface são calculados sobre aulas lançadas: presença ÷ (presença + falta); `justified` fica fora do denominador. O painel da Coordenação sinaliza abaixo de 75% depois de pelo menos cinco registros em 30 dias.

## Geolocalização

1. A Coordenação cadastra a localização da sala e um raio adequado ao ambiente físico.
2. O estudante permite localização no dispositivo e lê o QR presencial.
3. A API valida a assinatura/expiração do QR, o vínculo com turma, a chamada ativa e a distância até a geocerca.
4. Se a localização não está configurada, está imprecisa ou está fora do raio, a API recusa a chamada e não cria um registro.

O valor de raio é uma escolha operacional: GPS de celulares pode ser menos preciso em áreas internas. A equipe deve ajustar o raio e validar em sala antes de usar a frequência como registro oficial.

## Índices compostos

Os índices necessários estão versionados em `firestore.indexes.json` e conectados por `firebase.json`. Eles cobrem consultas de membros por pessoa/turma, aulas ativas e recentes, frequência por aluno/turma/colégio e protocolos por estudante/colégio. Se uma consulta nova exigir outro índice, o Firestore retorna o link para criar o índice; adicione-o ao arquivo versionado antes de publicar.

## Migração da primeira versão

O projeto anterior documentava `classIds` em usuários, `teacherIds/studentIds` em turmas e datas ISO como strings. A migração em `apps/api/src/scripts/migrate-firestore.ts` cria `class_memberships`, adiciona `schoolId`/`schemaVersion` e converte os campos de data para Firestore Timestamp. Ela deduplica vínculos pelo ID determinístico.

`db:migrate:check` faz leitura e mostra somente contagens. `db:migrate:apply` grava em lotes de até 400 documentos. A migração foi executada no projeto configurado; o Firestore estava vazio, então não houve documentos para converter. Os índices compostos foram publicados; as regras do cliente ainda precisam ser publicadas no projeto de destino.
