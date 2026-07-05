# 第4回：CI/CD・secrets・リリース経路 — ライブラリ汚染の被害拡大を防ぐ

## この回の目的

ライブラリ汚染の被害がCI/CD上で拡大する仕組みを理解し、CI/CDの権限分離、認証情報の最小化、リリース経路の保護を学ぶ。成果物としてCI/CD防御チェックリストを作成する。

---

## 1. CI/CDが攻撃者にとって価値の高い理由

### 1.1 CI/CD環境に集まるもの

CI/CD環境（ここではGitHub Actionsを主な例とする）には、攻撃者にとって価値の高いものが集まっている。

```
CI/CD環境にあるもの:

  権限:
    - repositoryへのwrite権限（コードの変更、branch作成）
    - package registryへのpublish権限
    - cloud環境へのdeploy権限
    - container registryへのpush権限

  認証情報:
    - npm publish token
    - Maven/Gradle deploy credential
    - AWS / GCP / Azure credential
    - GitHub PAT (Personal Access Token)
    - Docker registry credential
    - signing key

  成果物:
    - build artifact（JAR, Docker image等）
    - dependency cache
    - build cache

  自動化:
    - 人間が毎回中身を確認しない
    - push/PRをトリガーに自動実行
    - 定期実行（cron）
```

### 1.2 攻撃者の視点

攻撃者にとって、CI/CD環境の侵害は以下の理由で価値が高い。

| 理由 | 説明 |
|------|------|
| 権限の集中 | deploy, publish, cloud accessの権限が一箇所に集まっている |
| 自動実行 | 人間の確認なしに動作するため、検知されにくい |
| 信頼の連鎖 | CIでビルドされた成果物は「信頼されたもの」として扱われがち |
| 持続性 | CI cacheやartifactに悪性コードを残せば、繰り返し実行される |
| 横展開 | 一つのsecretから他のシステムへのアクセスが可能 |

---

## 2. ライブラリ汚染とCI/CDの関係

### 2.1 被害拡大の流れ

第2回・第3回で学んだライブラリ汚染が、CI/CD上でどのように被害拡大するかを整理する。

```
ライブラリ汚染 → CI/CD被害拡大の流れ:

  1. 悪性パッケージがlockfileに入る
     - 開発者がtyposquattingパッケージを追加
     - 正規パッケージのmaintainerが侵害され悪性バージョン公開
     - Dependabot/RenovateのPRで悪性バージョンが提案される

  2. PRがmergeされる

  3. CI/CDが起動する
     - npm ci / gradle build が実行される
     - 悪性コードがCI/CD環境で動作する

  4. CI/CD環境で悪性コードが動作
     - 環境変数を列挙 → secretsにアクセス
     - deploy credentialを窃取
     - npm publish tokenを窃取
     - cloud credentialを窃取

  5. 攻撃者が窃取した認証情報を利用
     - 本番環境へのアクセス
     - パッケージの改ざん
     - クラウドリソースの悪用
     - さらなるサプライチェーン攻撃
```
![sample](./images/04-cicd-secrets-release-image-01.png)

### 2.2 分離されていない場合の問題

CI/CDのjobが分離されていないと、テスト用のjobにdeploy用のsecretsが渡される。

```yaml
# 問題のある構成：1つのjobに全てが入っている
jobs:
  build-test-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci                    # ← ここで悪性コードが実行される
      - run: npm test
      - run: npm run build
      - run: npm publish               # ← このstepのためにNPM_TOKENがjob全体に渡されている
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - run: aws s3 sync dist/ s3://...  # ← このstepのためにAWS credentialがjob全体に
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

この構成では、`npm ci`の時点で環境変数にsecretsが存在するため、悪性コードがすべてのsecretにアクセスできる。

---

## 3. GitHub Actions workflowのpermissions

### 3.1 デフォルトのpermissions

GitHub Actionsでは、workflowに対してGITHUB_TOKENが自動的に付与される。デフォルトのpermissionsは、リポジトリの設定によって`read-write`または`read-only`のいずれかになる。

**リポジトリ設定で、デフォルトのpermissionsを`read-only`にすることを推奨する。**

### 3.2 workflowレベルでpermissionsを明示する

```yaml
# workflow全体のpermissions
permissions:
  contents: read    # リポジトリの内容を読む
  # 他のpermissionはデフォルトで none

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
```

permissionsを明示しない場合、デフォルトのpermissionsが適用される。**明示的に最小限のpermissionsを設定すべきである。**

### 3.3 主要なpermissions

| permission | 説明 | read-onlyで十分な場合 |
|-----------|------|---------------------|
| contents | リポジトリの内容 | テスト、ビルドのみ |
| packages | GitHub Packagesの読み書き | 読むだけの場合 |
| issues | issueの操作 | 通常不要 |
| pull-requests | PRへのコメント等 | status checkのみなら不要 |
| deployments | デプロイメントの操作 | テストjobには不要 |
| id-token | OIDCトークンの取得 | OIDCを使うjobのみ |
| actions | GitHub Actionsの操作 | 通常不要 |

### 3.4 jobレベルでpermissionsを分ける

```yaml
permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    # このjobはread-onlyで十分
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write    # OIDCに必要
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
      # OIDCでcloud credentialを取得してdeploy
```

---

## 4. deploy jobとtest jobの分離

### 4.1 分離の原則

**「依存関係をinstallしてテストするjob」と「deployやpublishの権限を持つjob」を分離する。**

```yaml
# 推奨構成：jobを分離
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - run: npm ci           # ← 悪性コードが実行されても
      - run: npm test          #    secretsにアクセスできない
      # このjobにはdeploy用のsecretsがない

  build:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: dist/

  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    # environment による保護
    environment: production
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: build-output
          path: dist/
      # deployのみ。npm ci は実行しない
      # → 悪性パッケージのコードが実行される機会がない
```

### 4.2 environmentによる保護

GitHub Actionsのenvironmentを使うと、特定のjobに対してapprovalを要求できる。

```yaml
jobs:
  deploy:
    environment: production  # production environmentに紐づく
    # → required reviewersの承認が必要
    # → 特定のbranchからのみ実行可能
    # → environment-specific secretsのみアクセス可能
```

environment設定：

- **Required reviewers** — deployの前に承認者のapprovalが必要
- **Branch protection** — 特定のbranch（main等）からのみ実行可能
- **Environment secrets** — そのenvironmentのjobでのみ利用可能なsecrets

### 4.3 分離のポイント

```
分離の考え方:

  npm ci / gradle build を実行するjob
    → 悪性コードが実行される可能性がある
    → secretsを渡さない
    → permissionsを最小にする

  deploy / publish を実行するjob
    → 必要なsecrets/permissionsを持つ
    → npm ci / gradle build を実行しない
    → ビルド済みのartifactを受け取って使う
```

---

## 5. secretsの管理

### 5.1 secretsのスコープ

GitHub Actionsでは、secretsのスコープを以下のように設定できる。

| スコープ | 設定場所 | アクセス範囲 |
|---------|---------|------------|
| Organization secrets | Organization設定 | 指定したリポジトリ全て |
| Repository secrets | リポジトリ設定 | そのリポジトリの全workflow |
| Environment secrets | Environment設定 | そのenvironmentを指定したjobのみ |

**secretsは最も狭いスコープで設定すべきである。**

```
推奨:
  deploy credential → environment secrets（production）
  npm publish token → environment secrets（npm-publish）
  テスト用API key  → repository secrets（やむを得ない場合のみ）
```

### 5.2 不要なsecretsの排除

CI/CDのsecrets一覧を定期的に棚卸しし、不要なsecretsを削除する。

確認ポイント：

```
□ 各secretが実際に使われているか
□ 使われているsecretは最小限の権限を持っているか
□ 長期間更新されていないsecretはないか
□ 退職者や異動者が作成したsecretはないか
□ 同じ目的で複数のsecretが存在していないか
```

### 5.3 secretsの露出防止

GitHub Actionsはsecretsをログ出力時にマスク（`***`）するが、完全ではない。

```yaml
# secretsが露出する可能性のあるパターン
- run: echo ${{ secrets.MY_SECRET }}          # ログに出力される
- run: curl -H "Auth: ${{ secrets.TOKEN }}" https://api.example.com  # URLに含まれると露出
- run: npm ci                                  # 悪性パッケージが環境変数を外部に送信
```

**secrets masking はベストエフォートであり、完全な防御ではない。** secretsを持つjobでは、悪性コードの実行機会を最小化することが重要である。

---

## 6. fork PRとpull_request_targetのリスク

### 6.1 fork PRからのsecretアクセス

外部のforkからのPRに対してCI/CDが実行されるとき、secretsへのアクセスを制限する必要がある。

| トリガー | secretsアクセス | 用途 |
|---------|---------------|------|
| `pull_request` | fork PRからはsecretsにアクセス不可 | 通常のPR CI |
| `pull_request_target` | fork PRからもsecretsにアクセス可能 | PRへのコメント等（注意が必要） |

### 6.2 pull_request_targetの危険性

`pull_request_target`は、fork PRのコンテキストでもbase repositoryのsecretsにアクセスできる。

```yaml
# 危険な構成
on:
  pull_request_target:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}  # ← fork PRのコードをcheckout
      - run: npm ci    # ← fork PRのpackage.jsonでinstall → 悪性コードが実行される
      - run: npm test  # ← base repositoryのsecretsにアクセス可能な状態
```

この構成では、攻撃者がfork PRで悪性のpackage.jsonやworkflow定義を含めることで、base repositoryのsecretsにアクセスできる。

**pull_request_targetで未信頼のコードをcheckout・buildしてはならない。**

---

## 7. third-party actionsの管理

### 7.1 third-party actionsのリスク

GitHub Actions workflowで使用するthird-party actionsも、サプライチェーン攻撃の対象である。

```yaml
# tagで参照している場合
- uses: some-org/some-action@v1    # ← tagが差し替えられる可能性がある

# branchで参照している場合（より危険）
- uses: some-org/some-action@main  # ← いつでも内容が変わる
```

2025年のtj-actions/changed-files事件では、人気のGitHub Actionが侵害され、CI/CDログにsecretsが露出するよう改ざんされた。

### 7.2 commit SHAによる固定

```yaml
# 推奨：commit SHAで固定
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
- uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0

# tagやbranchでの参照は避ける
- uses: actions/checkout@v4        # ← tagは差し替えられる可能性
- uses: actions/checkout@main      # ← branchは常に変化する
```

commit SHAで固定することで、actionの内容が変更されても影響を受けない。

**ただし、commit SHAの固定だけでは不十分な場合もある。** SHAが指すリポジトリ自体が侵害された場合（例：force pushでSHAが別のコミットに置き換えられた場合）、SHAによる固定では防げない。そのため、信頼できるorganizationのactionsを使い、定期的にSHAの更新を確認することが重要である。

### 7.3 Dependabotによるaction更新

Dependabotは、GitHub Actionsのthird-party actionsの更新PRも作成できる。

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

---

## 8. OIDCによる長期token削減

### 8.1 長期tokenの問題

従来のCI/CDでは、長期有効なtokenをsecretsに保存してきた。

```
長期tokenの問題:
  - 漏洩した場合、気づくまで悪用される
  - 有効期限が長い（または無期限）
  - スコープが広いことが多い
  - ローテーションが手動で面倒
  - 複数のリポジトリで同じtokenを使い回すことがある
```

### 8.2 OIDC（OpenID Connect）による解決

GitHub Actionsでは、OIDCを使うことでクラウドプロバイダーへアクセスするための長期secretを保存せず、workflow実行時に短命のtokenを発行する構成が可能である。

```
OIDCの流れ:
  1. GitHub Actions workflowが実行される
  2. GitHubがOIDC tokenを発行（短命）
  3. OIDC tokenをクラウドプロバイダーに提示
  4. クラウドプロバイダーがtokenを検証
  5. 短命のcloud credentialを発行
  6. そのcredentialでデプロイ等を実行
  7. credentialは自動的に失効
```

```yaml
# AWS OIDCの例
jobs:
  deploy:
    permissions:
      id-token: write    # OIDC tokenの取得に必要
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@e3dd6a429d7300a6a4c196c26e071d42e0343502
        with:
          role-to-arn: arn:aws:iam::123456789012:role/github-actions-role
          aws-region: ap-northeast-1
      # 以降、短命のAWS credentialが利用可能
```

### 8.3 OIDCの利点

| 観点 | 長期token | OIDC |
|------|----------|------|
| 有効期限 | 長期（手動ローテーション） | 短命（自動失効） |
| 漏洩時の影響 | 気づくまで悪用可能 | 失効済みで影響なし |
| スコープ | 手動で設定 | ロールで厳密に制御 |
| ローテーション | 手動 | 不要（毎回新しいtoken） |
| secretsの管理 | secrets に保存が必要 | secretsに保存不要 |

### 8.4 npm Trusted Publishing（再掲）

npmでもTrusted Publishingにより、CI/CDからOIDCを使ってパッケージを公開できる。

```
npm Trusted Publishingの利点:
  - 長期のnpm publish tokenが不要
  - 特定のGitHub Actions workflowからのみ公開可能
  - リポジトリ、branch、environmentを制限できる
  - tokenの漏洩リスクを大幅に削減
```

---

## 9. dependency cacheとbuild cacheの安全性

### 9.1 cacheのリスク

CI/CDでは、ビルド時間を短縮するためにdependency cacheやbuild cacheを利用する。

```yaml
# GitHub Actionsでのcache例
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: npm-${{ hashFiles('package-lock.json') }}
```

**cacheにも攻撃のリスクがある。**

```
cacheのリスクシナリオ:
  1. 悪性パッケージが一度installされる
  2. cacheに保存される
  3. lockfileが修正されても、cacheが残っていれば悪性パッケージが使われ続ける
```

### 9.2 cacheの管理

- cacheのキーにlockfileのhashを使う
- 悪性パッケージが見つかった場合、cacheを明示的に削除する
- cache poisoningのリスクを認識する

---

## 10. リリース経路の保護

### 10.1 リリース経路とは

リリース経路は、コードがソースリポジトリから本番環境（またはpackage registry）に到達するまでの道筋である。

```
リリース経路の例:

  Webアプリケーション:
    source → build → test → staging → production

  npmパッケージ:
    source → build → test → npm publish

  コンテナ:
    source → build → test → container image build → registry push → deploy
```

### 10.2 リリース経路の保護ポイント

| ポイント | 対策 |
|---------|------|
| ソース | branch protection、required review |
| ビルド | Dependency Verification、SCAツール |
| テスト | 自動テスト、セキュリティテスト |
| 公開/デプロイ | OIDC、environment protection、required approval |
| 成果物 | artifact signing、provenance |

### 10.3 branch protectionとの連携

```
branch protection設定:
  - main branchへの直接pushを禁止
  - PR作成時にrequired reviewを要求
  - status check（CI）のpassを要求
  - force pushを禁止
```

これにより、悪性コードがmergeされる前にレビューとCIチェックを経ることが保証される。ただし、レビューの質がボトルネックになることに注意する。

---

## 11. CI/CD防御チェックリスト

この回の成果物として、以下のチェックリストを共有する。

### permissions

```
□ リポジトリのデフォルトpermissionsをread-onlyに設定しているか
□ workflowごとにpermissionsを明示しているか
□ write権限が必要なjobだけに限定されているか
□ 各jobに必要最小限のpermissionsを設定しているか
```

### jobの分離

```
□ test jobとdeploy jobを分離しているか
□ npm ci / gradle buildするjobに不要なsecretがないか
□ deploy jobはビルド済みartifactを受け取る構成か
□ deploy jobにenvironment protectionを設定しているか
```

### secrets

```
□ secretsは最も狭いスコープで設定しているか
□ 不要なsecretsがないか定期的に棚卸ししているか
□ 長期tokenではなくOIDCを使える箇所はないか
□ npm publish tokenをTrusted Publishingに移行できないか
□ secretsのローテーション手順があるか
```

### fork PRとtrust boundary

```
□ fork PRからsecretsへアクセスできないか
□ pull_request_targetで未信頼コードをcheckout/buildしていないか
□ 外部からのPRに対するCI実行ポリシーがあるか
```

### third-party actions

```
□ third-party actionsをcommit SHAで固定しているか
□ 使用しているactionsの信頼性を確認しているか
□ actionsの更新をDependabotで管理しているか
□ 必要のないthird-party actionsを使っていないか
```

### cache

```
□ cacheのキーにlockfileのhashを含めているか
□ インシデント時にcacheを削除する手順があるか
□ cacheの有効期間を設定しているか
```

### リリース経路

```
□ branch protectionを設定しているか
□ required reviewを設定しているか
□ status check（CI）のpassを要求しているか
□ deploy/publishにapprovalを要求しているか
```

---

## 12. まとめと次回への接続

### この回で学んだこと

1. **CI/CDが攻撃者にとって価値の高い理由** — 権限の集中、自動実行、信頼の連鎖
2. **ライブラリ汚染とCI/CDの関係** — 悪性コードがCI/CD上でsecretsにアクセスする流れ
3. **permissionsの明示と最小化** — デフォルトread-only、jobレベルでの設定
4. **deploy jobとtest jobの分離** — secretsを持つjobと依存installを実行するjobの分離
5. **secretsのスコープ管理** — environment secretsの活用
6. **OIDCによる長期token削減** — 短命のcredentialで認証情報の漏洩リスクを低減
7. **third-party actionsの固定** — commit SHAによるpinning
8. **cacheの安全性** — cache poisoningのリスクと対策

### 次回予告：第5回 インシデント対応と標準化

次回は、ライブラリ汚染が発生した場合のインシデント対応と、チーム標準への落とし込みを扱う。

- 悪性パッケージを踏んだときの初動
- tokenの失効とsecretのローテーション
- CI/CD停止判断
- lockfile rollbackとclean build
- 開発者端末の扱い
- audit logの確認
- 関係者連絡
- postmortem
- インシデント初動runbookの作成
- 第1回〜第4回の成果物をチーム標準に落とし込む

---

## 確認問題

1. CI/CDのjobが分離されていない場合、ライブラリ汚染の被害がどのように拡大するか説明できるか
2. `pull_request`と`pull_request_target`の違いを、secretsアクセスの観点から説明できるか
3. OIDCを使う利点を、長期tokenとの比較で説明できるか
4. third-party actionsをcommit SHAで固定すべき理由と、その限界を説明できるか
5. deploy jobとtest jobを分離する構成を、具体的なworkflow構成で説明できるか
