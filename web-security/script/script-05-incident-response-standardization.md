# 第4回：CI/CD・Secrets・リリース経路 — ライブラリ汚染の被害拡大を防ぐ

---

# オープニング


皆さんこんにちは。

第4回の勉強会を始めます。

今回のテーマは、

「CI/CD・Secrets・リリース経路」

です。

前回までは、サプライチェーン攻撃の入口となるライブラリ汚染について学んできました。

例えば、

* タイポスクワッティング
* 悪意あるアップデート
* メンテナーアカウントの侵害

などによって、悪意のあるライブラリがプロジェクトへ入り込む可能性があることを見てきました。

ただし、攻撃者の目的はライブラリを混入させることではありません。

本当に狙っているのは、

そのライブラリをCI/CD上で実行することです。

なぜならCI/CDには、

* 本番環境へのデプロイ権限
* パッケージ公開権限
* クラウド操作権限
* Secrets ManagerやParameter Storeから取得できる認証情報

など、価値の高いものが集まっているからです。

今回はAWSのCI/CD、具体的にはCodePipelineとCodeBuildを主な例として、

* なぜCI/CDが狙われるのか
* 被害はどのように拡大するのか
* CodePipeline / CodeBuildではどう防ぐのか

を順番に見ていきます。

---

# この回の目的


この回では、

ライブラリ汚染が発生したあと、

CI/CD上でどのように被害が広がるのかを学びます。

そして、

* IAM Roleによる権限分離
* Secrets Manager / Parameter Storeを使ったSecrets管理
* CodePipelineのStage分離
* CodeBuild ProjectごとのService Role分離
* Manual approvalによる本番反映前の保護
* リリース経路全体の保護

という観点から対策を見ていきます。

最後には、

実際のプロジェクトでも利用できるCI/CD防御チェックリストを確認します。

---

# 1. CI/CDが攻撃者にとって価値の高い理由

発表者メモ：

受講者への問いかけ

「攻撃者だとしたら、開発者1人のPCとCI/CD環境ならどちらを狙いますか？」

---

## 1.1 CI/CD環境に集まるもの


まず最初に、

なぜ攻撃者がCI/CDを狙うのかを考えてみます。

CI/CDには大きく4種類の重要なものが集まっています。

1つ目は権限です。

CodePipelineやCodeBuildは、単にテストを実行するだけではありません。

構成によっては、

* S3へのデプロイ
* ECRへのイメージPush
* ECSサービスの更新
* CloudFormation Stackの更新
* パッケージレジストリへの公開

などを行う権限を持ちます。

2つ目は認証情報です。

例えば、

* npm publish token
* MavenやGradleのdeploy credential
* 外部SaaSのAPI token
* Docker registry credential
* signing key
* Secrets ManagerやParameter Storeから取得されるsecret

などです。

3つ目は成果物です。

* Build Artifact
* Dependency Cache
* Build Cache
* CodePipeline Artifact

などがあります。

4つ目は自動化です。

ソースコードの変更をきっかけに自動で実行され、

人間が毎回コマンドの中身を細かく確認するわけではありません。

つまりCI/CDは、

強い権限と認証情報が集中していて、

しかも自動で動く場所です。

これが攻撃者にとって魅力的な理由です。

---

## 1.2 攻撃者の視点


攻撃者の視点で見ると、

CI/CD環境には5つの価値があります。

1つ目は、権限の集中です。

CodeBuildのService Roleに本番デプロイ権限やSecret取得権限が付いていれば、

その実行環境を侵害することでAWSリソースへアクセスできる可能性があります。

2つ目は、自動実行です。

開発者が毎回手で確認しなくても、

変更をきっかけに処理が自動実行されます。

3つ目は、信頼の連鎖です。

CI/CDで作られた成果物は、

「パイプラインで作られたものだから信頼できる」

と扱われがちです。

4つ目は、持続性です。

悪性コードがcacheやartifactに残ると、

ソースコードを直した後も影響が残ることがあります。

5つ目は、横展開です。

一つのSecretやService Role権限から、

別のAWSリソースや外部サービスへ被害が広がる可能性があります。

### この章のまとめ

CI/CDは単なる自動化ツールではありません。

権限とSecretsが集中するため、

攻撃者にとって価値の高い標的です。

---

# 2. ライブラリ汚染とCI/CDの関係

## 章へのつなぎ

ここまでで、

なぜCI/CDが狙われるのかを見てきました。

では実際に、

悪意あるライブラリが混入すると、

どのように被害が広がるのでしょうか。

次はその流れを見ていきます。

---

## 2.1 被害拡大の流れ


この図は今回の資料の中でも重要な図です。

流れを順番に見ていきます。

まず、

悪意あるライブラリがlockfileへ入ります。

例えば、

タイポスクワッティングのパッケージを追加してしまう。

正規パッケージのメンテナーアカウントが侵害され、

悪性バージョンが公開される。

自動更新PRで悪性バージョンが提案される。

このような入口があります。

その後、

変更がマージされます。

するとCodePipelineがSource変更を検知し、

CodeBuildが起動します。

CodeBuildでは、

npm ciやgradle buildが実行されます。

ここで重要なのは、

悪意あるコードがCI/CD環境で実行されることです。

攻撃者は、

環境変数を列挙したり、

CodeBuild Service Roleの権限を使ってAWS APIを呼び出したり、

Secrets ManagerやParameter Storeから読める情報を狙ったりします。

例えば、

* npm publish token
* 外部SaaS token
* Deploy用の認証情報
* 本番環境へアクセスできるService Role権限

などです。

そして盗んだ認証情報や権限を利用して、

本番環境へのアクセスやパッケージ改ざんを行います。

つまり、

ライブラリ汚染だけでは終わりません。

CI/CD上で実行されることで被害が拡大します。

---

## 2.2 分離されていない場合の問題


資料のCodeBuild例を見てください。

一つのCodeBuild Projectの中で、

* npm ci
* test
* build
* publish
* deploy

をすべて実行しています。

一見するとシンプルで分かりやすい構成です。

しかし、ここに大きな落とし穴があります。

publishのためにNPM_TOKENを渡しています。

deployのために本番S3への更新権限をService Roleに付与しています。

この場合、

npm ciを実行しているタイミングでも、

同じCodeBuild実行環境にSecretや本番権限が存在します。

もし悪意あるライブラリがnpm ciのタイミングで実行された場合、

その時点でSecretやService Role権限を悪用される可能性があります。

ここで重要なのは、

「deployのために必要な権限」が、

「依存ライブラリをinstallする処理」にも見えてしまうことです。

これが分離されていないCI/CDの問題です。

### この章のまとめ

ライブラリ汚染だけではなく、

CI/CD実行で被害が拡大します。

特に危険なのは、

依存ライブラリを実行する処理と、

本番deploy権限やSecretsを持つ処理が同じ環境にあることです。

---

# 3. CodePipeline / CodeBuildの権限設計

## 章へのつなぎ

前の章では、

Secretsや本番権限が同じ実行環境にあると危険だと説明しました。

そこで次は、

CodePipeline / CodeBuildでは権限をどこで制御するのかを見ていきます。

---

## 3.1 CodeBuildの権限はIAM Roleで決まる


CodePipeline / CodeBuildでは、

権限の中心はIAM Roleです。

大きく分けると、

CodePipeline Service RoleとCodeBuild Service Roleがあります。

CodePipeline Service Roleは、

Pipeline全体を動かすためのRoleです。

例えば、

Source、Build、DeployなどのActionを起動したり、

artifact bucketを読み書きしたり、

CodeBuildを起動したりします。

一方、CodeBuild Service Roleは、

CodeBuildのビルド中に使われるRoleです。

つまり、buildspec.ymlのcommandsでAWS CLIを実行した場合、

そのAWS API操作はCodeBuild Service Roleの権限で行われます。

ここが重要です。

CodeBuildで何ができるかは、

buildspec.ymlの見た目だけでは決まりません。

そのCodeBuild Projectに紐づくService Roleに、

どのIAM権限が付いているかで決まります。

そのため、

Test用、Build用、Deploy用でCodeBuild Projectを分け、

Service Roleも分けることが重要です。

---

## 3.2 Test用Projectは最小権限にする


Test用のCodeBuild Projectでは、

基本的にテストだけができれば十分です。

必要なのは、

Source Artifactを読むこと、

ログをCloudWatch Logsに出すこと、

必要に応じてテスト結果やartifactを出力することです。

逆に不要なのは、

* 本番S3へのdeploy権限
* ECSサービスの更新権限
* ECRへのPush権限
* CloudFormation Stackの更新権限
* 本番Secretsの取得権限

です。

Test用Projectではnpm ciが実行されます。

npm ciでは依存ライブラリのinstall scriptなどが動く可能性があります。

そのため、

Test用Projectに強い権限を付けるべきではありません。

ここでの考え方はシンプルです。

危険なコードが実行される可能性がある場所には、

強い権限を置かない。

これが最小権限の基本です。

---

## 3.3 主要なIAM権限


ここで重要なのは、

IAM権限の一覧を暗記することではありません。

大事なのは、

処理ごとに必要な権限を分けて考えることです。

ログ出力やArtifactの読み書きは、

TestやBuildでも必要になることがあります。

一方で、

Secrets Managerから本番Secretを読む権限や、

ECSを更新する権限、

CloudFormation Stackを更新する権限は、

Testでは基本的に不要です。

Deployでだけ必要な権限は、

Deploy用Projectにだけ付けます。

これによって、

もしTestで悪性コードが動いたとしても、

本番環境への影響を小さくできます。

---

## 3.4 Stage / Project単位でRoleを分ける


CodePipeline / CodeBuildでは、

StageとCodeBuild Projectを分けることで、

処理と権限を分離します。

例えば、

Source Stageではソースコードを取得します。

Test Stageでは、

app-testというCodeBuild Projectでnpm ciとnpm testを実行します。

このProjectにはSecretsを渡しません。

Build Stageでは、

app-buildというProjectでビルドを行い、

BuildArtifactを出力します。

このProjectにも本番deploy権限は付けません。

その後、

Approval Stageで人間の承認を挟みます。

最後にDeploy Stageで、

app-deployというProjectがBuildArtifactを受け取り、

本番環境へ反映します。

このDeploy用Projectにだけ、

必要なdeploy権限を付けます。

つまり、

CodePipelineではStageを分け、

CodeBuildではProjectとService Roleを分ける。

これがAWS CI/CDにおける権限分離の基本です。

### この章のまとめ

CodePipeline / CodeBuildでは、

権限はbuildspec.ymlではなくIAM Roleで管理します。

Test、Build、DeployでProjectとService Roleを分け、

必要最小限の権限だけを付与します。

---

# 4. Deploy StageとTest Stageの分離

発表者メモ：

この資料で最重要の章。

必ず

「Secretsや本番権限を持つStageでnpm ciしない」

を強調する。

---

## 4.1 分離の原則

### buildspec-test.yml

```yaml
version: 0.2

phases:
  install:
    runtime-versions:
      nodejs: 20
    commands:
      - npm ci           # ← 悪性コードが実行されても

  build:
    commands:
      - npm test         #    deploy用secretsや本番権限にアクセスできない
```

### buildspec-build.yml

```yaml
version: 0.2

phases:
  install:
    runtime-versions:
      nodejs: 20
    commands:
      - npm ci

  build:
    commands:
      - npm run build

artifacts:
  files:
    - "**/*"
  base-directory: dist
```

### buildspec-deploy.yml

```yaml
version: 0.2

phases:
  build:
    commands:
      # deployのみ。ここでは npm ci / npm install を実行しない
      # CodePipelineから渡されたBuildArtifactをそのまま使う
      - aws s3 sync . s3://your-production-bucket --delete
```

ポイントは、**悪性パッケージが実行される可能性がある`npm ci`をTest / Buildに閉じ込め、Deployでは依存関係のinstallをしない**ことである。


ここが今回の資料で最も重要なポイントです。

依存ライブラリをインストールする処理と、

Deployする処理を分離します。

Test Stageでは、

npm ciを実行します。

しかし、

Secretsは持ちません。

Deploy権限も持ちません。

Build Stageでも、

npm ciやnpm run buildを実行します。

しかし、

本番環境を更新する権限は持ちません。

Deploy Stageでは、

本番環境へ反映する権限を持ちます。

しかし、

npm ciは実行しません。

Deploy Stageは、

Build Stageで作成されたBuildArtifactを受け取り、

それをそのままdeployします。

つまり、

信頼できない可能性がある依存ライブラリの実行と、

強い本番権限を分離します。

この設計によって、

仮にTestやBuildで悪性コードが実行されたとしても、

本番deploy権限や本番Secretsへ届きにくくできます。

覚えるべきポイントは一つです。

**Secretsや本番権限を持つStageでnpm ciしない。**

これです。

---

## 4.2 Manual approvalによる保護

### Deploy用CodeBuild Service Role例

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DeployToProductionS3",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::your-production-bucket",
        "arn:aws:s3:::your-production-bucket/*"
      ]
    },
    {
      "Sid": "ReadDeploySecretsOnlyIfNeeded",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:prod/deploy/*"
    }
  ]
}
```

Test / Build用のRoleには、上記のような本番deploy権限やsecret取得権限を付けない。


CodePipelineでは、

Deploy Stageの前にManual approvalを置くことができます。

これは、本番反映前に人間の承認を要求する仕組みです。

Manual approvalでは、

単に「承認ボタンを押す」だけではなく、

何を確認するのかを決めておくことが重要です。

例えば、

変更内容が本番へ反映してよいものか。

BuildとTestが通っているか。

Deploy対象が、Build Stageで作成されたArtifactか。

信頼済みbranchからの変更か。

通常リリースなのか、緊急リリースなのか。

こういった観点を確認します。

また、

Deploy用のService Roleには本番deployに必要な権限だけを付けます。

例えばS3へ静的ファイルをdeployするなら、

対象bucketへの必要な操作だけに限定します。

Secrets Managerを読む必要がある場合も、

Deploy用のsecretだけに限定します。

TestやBuild用のRoleには、

このような本番deploy権限やsecret取得権限を付けません。

---

## 4.3 分離のポイント


ここまでの話を整理します。

npm ciやgradle buildを実行するStageでは、

悪性コードが実行される可能性があります。

そのため、

Secretsを渡さない。

Service Roleを最小にする。

Deploy権限を付けない。

これが基本です。

一方で、

DeployやPublishを実行するStageでは、

必要なSecretや権限を持ちます。

しかし、

npm ciやgradle buildは実行しません。

Build済みのArtifactを受け取って使います。

そして本番反映前には、

Manual approvalを挟みます。

このように、

「悪性コードが動きうる場所」と「強い権限を持つ場所」を分離することが、

この章の一番重要なポイントです。

### この章のまとめ

Test / Build / Deployを分離します。

Secretsや本番権限を持つDeploy Stageでは、

依存ライブラリのinstallを実行しない構成にします。

---

# 5. Secretsの管理

## 章へのつなぎ

ここまでで、

Stage分離によって、

「Secretsを持つStageで依存ライブラリを実行しない」

ことが重要だと分かりました。

次は、

そのSecrets自体をどのように管理するのかを見ていきます。

---

## 5.1 Secretsのスコープ


CodePipeline / CodeBuildでは、

Secretsや権限のスコープを複数の場所で制御します。

まずIAM Roleです。

CodeBuild ProjectごとにService Roleを分けることで、

そのProjectが実行できるAWS操作を制御できます。

次にSecrets Managerです。

Secret単位で管理でき、

IAMで許可されたRoleだけが値を取得できます。

Parameter Storeも同様に、

Parameter単位で管理し、

IAMでアクセスを制御できます。

また、CodeBuildのenvironment variablesも注意が必要です。

一度環境変数として渡すと、

そのProjectのbuild中のプロセスから参照できる状態になります。

ここで覚えてほしいことは一つです。

Secretsは、

**最も狭いスコープで管理する**

ということです。

Deployでしか使わないSecretは、

Deploy用CodeBuild ProjectのService Roleだけが取得できれば十分です。

Test用Projectから見える必要はありません。

---

## 5.2 不要なSecretsの排除


Secretsは一度登録すると、

長期間残り続けることがあります。

しかし、

使われていないSecretsはリスクになります。

例えば、

昔のdeploy tokenが残っている。

退職者や異動者が作成したSecretが残っている。

同じ目的のSecretが複数存在している。

長期間ローテーションされていない。

このような状態は危険です。

また、AWS CI/CDでは、

Secretそのものだけでなく、

Secretを読めるIAM Roleも確認します。

Test用Projectから本番Secretを読めないか。

Deploy用Roleが必要以上に広いAWS権限を持っていないか。

このような観点で棚卸しします。

不要な権限は削除する。

不要な認証情報も削除する。

これは運用上とても重要です。

---

## 5.3 Secretsの露出防止


CodeBuildでは、

Secrets ManagerやParameter Storeの値を、

環境変数としてbuild環境へ渡すことができます。

これは便利ですが、注意が必要です。

環境変数として渡した時点で、

そのbuild中のプロセスから参照できます。

つまり、

npm ciで悪性パッケージが実行された場合、

環境変数を読み取って外部に送信される可能性があります。

また、

echoでSecretを出力したり、

curlのheaderなどに含めたりすると、

ログや通信経路で露出するリスクもあります。

ここで誤解してはいけないのは、

ログのマスクや秘匿設定は完全な防御ではないということです。

本当の対策は、

Secretsを持つProjectで信頼できないコードを実行しないことです。

ここでもStage分離とProject分離の考え方につながります。

### この章のまとめ

Secretsは最小スコープで管理します。

そして、

ログのマスクに依存するのではなく、

Secretsを持つProjectで依存ライブラリを実行しない設計を行います。

---

# 6. PR検証と信頼境界のリスク

## 章へのつなぎ

ここまではSecrets管理について説明しました。

次は、

PR検証や未信頼branchを扱うときの信頼境界について説明します。

---

## 6.1 外部PRからのSecretアクセス


PR検証では、

まだ信頼できるとは限らないコードを実行します。

例えば、

外部のforkからのPRや、

権限の弱いbranchからの変更です。

このようなコードに対してCIを回すこと自体はよくあります。

しかし、

そのCI環境に本番Secretやdeploy権限を持たせてはいけません。

PR検証用のCodeBuild Projectは、

lint、test、build確認だけを行います。

Secretsは原則なし。

Deploy権限もなし。

Artifactも本番deployには使わない。

このように、

PR検証用のCIと、

main向けのリリースPipelineを分けることが重要です。

---

## 6.2 未信頼コードを本番権限付きProjectでbuildしない


危険なのは、

未信頼のPRコードを、

本番権限付きのCodeBuild Projectでbuildしてしまうことです。

例えば、

外部PRのコードをDeploy用Projectで実行し、

そのProjectのService Roleに本番deploy権限がある。

さらにSecrets Managerから本番Secretも読める。

この状態でnpm ciを実行すると、

攻撃者がPRに仕込んだ悪性スクリプトが、

本番SecretやService Role権限に触れる可能性があります。

そのため、

未信頼コードはPR検証用Projectでのみ実行します。

このProjectには、

Secretsを渡さない。

Deploy権限を付けない。

本番deployに使うArtifactも作らせない。

一方、main向けのリリースPipelineは、

信頼済みbranchから始まり、

Test、Build、Approval、Deployの流れで進みます。

ここでもDeploy権限はDeploy Stageだけに限定します。

### この章のまとめ

PRや未信頼branchのコードは、

本番権限付きのProjectで実行してはいけません。

PR検証用Projectとリリース用Pipelineを分けることが重要です。

---

# 7. 外部ツール・外部スクリプトの管理

## 章へのつなぎ

これまではアプリケーションの依存関係を見てきました。

しかし、

CI/CDではbuildspec.ymlの中で外部ツールや外部スクリプトを実行することもあります。

次はそのリスクを見ていきます。

---

## 7.1 外部ツール・外部スクリプトのリスク


CI/CDで実行されるコードは、

アプリケーションの依存ライブラリだけではありません。

CodeBuildでは、

buildspec.ymlのcommandsに書いたコマンドが実行されます。

その中で、

外部のinstall scriptをcurlで取得してbashに渡す。

毎回latest版のtoolを取得する。

checksumを確認せずにbinaryをダウンロードする。

latest tagのcontainer imageを使う。

このような構成もリスクになります。

なぜなら、

CI/CD上で実行する外部コードが、

いつの間にか変わる可能性があるからです。

外部スクリプトの配布元が侵害された場合、

CI/CD上で任意コードが実行される可能性があります。

つまり、

アプリケーションのライブラリだけでなく、

CI/CDで使う外部ツールや外部スクリプトも、

サプライチェーンの一部として管理する必要があります。

---

## 7.2 version固定とhash検証


対策として重要なのは、

実行する外部コードを固定し、

可能な限り検証することです。

例えば、

外部ツールを入れる場合は、

latestではなく明示的なバージョンを指定します。

さらに、

配布元が提供しているchecksumを使って、

ダウンロードしたbinaryが期待通りか確認します。

container imageを使う場合も同じです。

latest tagは避けます。

可能であれば、

image digestで固定します。

これにより、

ビルドのたびに実行されるコードが変わるリスクを下げられます。

ただし、固定すれば終わりではありません。

固定したバージョンに脆弱性が見つかることもあります。

そのため、次の更新管理とセットで考える必要があります。

---

## 7.3 依存ツールの更新管理


バージョン固定には弱点もあります。

それは、

固定したまま放置すると古くなることです。

古いtoolやbase imageには、

脆弱性が残る可能性があります。

そのため、

固定と更新はセットで考えます。

toolやbase imageのversionを明示する。

更新PRを自動化ツールで作成する。

更新時にはchecksumやdigestも更新する。

そして、人間が更新内容を確認する。

また、

不要な外部ツールはそもそも使わないことも重要です。

CI/CDで実行する外部コードが増えるほど、

攻撃対象も増えるからです。

### この章のまとめ

CI/CDで使う外部ツールや外部スクリプトも依存関係です。

version固定、checksum検証、digest固定、継続的な更新管理を行います。

---

# 8. CodeBuild Service Roleによる長期Token削減

## 章へのつなぎ

ここまで、

Secretsを守る方法について説明してきました。

しかし、

そもそも長期Tokenを減らせるなら、その方が安全です。

そこで、

CodeBuild Service RoleによるAWS認証の考え方を見ていきます。

---

## 8.1 長期Tokenの問題


従来のCI/CDでは、

長期有効なtokenをSecretsとして保存することがよくありました。

例えば、

AWS Access Keyを環境変数として持たせる。

npm publish tokenをCI/CDのSecretとして持たせる。

外部SaaSのAPI tokenをProjectに持たせる。

このような構成です。

しかし、長期Tokenには問題があります。

もし漏えいすると、

気づいて失効するまで悪用されます。

有効期限が長い、

または無期限の場合もあります。

スコープが広くなりがちで、

ローテーションも手動で面倒です。

さらに、

複数のProjectやrepositoryで同じTokenを使い回すと、

一つ漏れただけで影響範囲が広がります。

---

## 8.2 AWS内のdeployでは長期アクセスキーを持たせない


CodeBuildはAWSサービスとして実行されます。

そのため、

AWSリソースへのアクセスは、

基本的にCodeBuild Service Roleで行います。

CodeBuild ProjectにService Roleを紐づけると、

build環境には一時的なAWS credentialが提供されます。

その一時credentialでAWS APIを実行します。

つまり、

AWSへdeployするために、

AWS_ACCESS_KEY_IDやAWS_SECRET_ACCESS_KEYのような長期アクセスキーを、

CodeBuildの環境変数に直接入れる必要は原則ありません。

避けたいのは、

CodeBuildのenvに長期アクセスキーを持たせる構成です。

代わりに、

Deploy用CodeBuild Service Roleへ、

必要なdeploy権限だけを付与します。

この方が、

権限の範囲も分けやすく、

長期アクセスキーの漏えいリスクも減らせます。

---

## 8.3 外部サービスTokenはSecrets Manager等で管理する


一方で、

すべてのSecretが不要になるわけではありません。

例えば、

npm publish tokenや外部SaaSのAPI tokenなど、

AWS外のサービスへアクセスする認証情報は残る場合があります。

その場合は、

Secrets ManagerやParameter Storeで管理します。

そして、

そのSecretを読めるIAM Roleを限定します。

例えば、

NPM_TOKENはPublish用CodeBuild Service Roleだけが読めるようにします。

Test用ProjectやBuild用Projectからは読めないようにします。

こうすることで、

Secretが必要な場所を限定できます。

---

## 8.4 長期Token削減の利点


CodeBuild Service Roleを使う利点は、

AWSの長期アクセスキーをCI/CDに直接保存しなくてよいことです。

漏えい時の影響を限定しやすくなります。

また、

RoleをStageやProject単位で分けられるため、

Test用、Build用、Deploy用で権限を切り分けやすくなります。

AWS credential自体は一時的なものなので、

長期アクセスキーのローテーション作業も不要になります。

外部サービスのSecretは残る場合がありますが、

それもSecrets ManagerやParameter Storeに集約し、

読めるRoleを限定します。

### この章のまとめ

AWSへのdeployでは、

長期アクセスキーをCodeBuildへ直接持たせないことが基本です。

CodeBuild Service Roleを使い、

外部サービスのTokenはSecrets Manager / Parameter Storeで管理し、

読めるRoleを限定します。

---

# 9. dependency cacheとbuild cacheの安全性

## 章へのつなぎ

ここまでで、

IAM権限、

Stage分離、

Secrets、

長期Token削減について説明してきました。

次は見落とされがちなCacheについて見ていきます。

---

## 9.1 Cacheのリスク


CI/CDでは、

ビルド高速化のためにCacheを利用します。

例えば、

npm packageのダウンロード結果や、

ビルド途中の成果物を保存します。

これは便利ですが、

攻撃者にとっても便利に働くことがあります。

資料のシナリオを見てください。

まず、

悪意あるライブラリが一度installされます。

その内容がCacheへ保存されます。

その後、

lockfileを修正したとしても、

Cacheが再利用される可能性があります。

つまり、

プロジェクトから削除したつもりでも、

Cache経由で残り続けることがあります。

Cacheは単なる高速化機能ではなく、

CI/CD上で実行されるものに影響する管理対象です。

---

## 9.2 Cacheの管理


Cacheの対策は大きく5つあります。

まず、

lockfileの変更をCache運用に反映することです。

依存関係が変わったのに、

古いCacheを使い続けると危険です。

次に、

インシデント発生時はCacheも削除します。

ソースコード修正だけでは不十分です。

3つ目は、

Cache Poisoningのリスクを理解することです。

Cacheに悪性の内容が残ると、

以後のbuildにも影響します。

4つ目は、

Test、Build、DeployでCacheを共有しすぎないことです。

特にDeploy Stageでは、

依存関係installやCache利用を避けるべきです。

最後に、

Cache削除手順を運用に含めます。

インシデント時に、

どのCacheをどう削除するか分からないと、

復旧が遅れます。

### この章のまとめ

Cacheは単なる高速化機能ではありません。

セキュリティ管理の対象です。

悪性パッケージ対応時には、

lockfileやソースコードだけでなくCacheも確認します。

---

# 10. リリース経路の保護

## 章へのつなぎ

ここまで個別の対策を見てきました。

しかし、

攻撃者は特定の場所だけを狙うわけではありません。

そこで、

リリース経路全体を見ていきます。

---

## 10.1 リリース経路とは


リリース経路とは、

ソースコードが利用者へ届くまでの流れです。

例えばWebアプリなら、

source、test、build、approval、production

という流れです。

npmパッケージなら、

最後はnpm publishになります。

コンテナなら、

container imageをbuildし、

registryへpushし、

その後deployします。

攻撃者は、

Buildだけ、

Deployだけ、

Sourceだけを狙うとは限りません。

そのため、

リリース経路全体で考える必要があります。

---

## 10.2 保護ポイント


リリース経路には、

それぞれ保護ポイントがあります。

ソースコードでは、

branch protectionやrequired reviewを設定します。

Buildでは、

Dependency VerificationやSCAツールを利用します。

Testでは、

自動テストやセキュリティテストを行います。

公開やDeployでは、

CodeBuild Role分離、Manual approval、最小権限IAMが重要です。

成果物では、

artifact signingやprovenanceを検討します。

重要なのは、

どれか一つで守るのではなく、

複数の防御を重ねることです。

これをDefense in Depth、

つまり多層防御と呼びます。

---

## 10.3 Branch ProtectionとCodePipelineの連携


Branch Protectionは、

リリース経路の入口を守るために重要です。

例えば、

main branchへの直接pushを禁止する。

PR作成時にreviewを要求する。

CIの成功を必須にする。

force pushを禁止する。

こういった設定です。

これにより、

悪性コードがいきなりmainへ入り、

そのまま本番へ進むリスクを下げられます。

ただし、

Branch Protectionだけで十分ではありません。

CodePipeline側でも、

Source Stageを信頼済みbranchに限定します。

PR branchやforkは、

PR検証用CodeBuildだけを実行し、

Secretsなし、Deployなしにします。

main branchだけが、

CodePipelineのTest、Build、Approval、Deployへ進めるようにします。

### この章のまとめ

個別の設定だけでは不十分です。

ソース、Build、Test、Deploy、成果物まで、

リリース経路全体を守ることが重要です。

---

# 11. CI/CD防御チェックリスト

## 章へのつなぎ

ここからは総まとめです。

実際のプロジェクトで確認できるように、

チェックリスト形式で振り返ります。

---

## IAM permissions


まずIAM permissionsです。

確認ポイントは、

CodeBuild ProjectごとにService Roleを分けているか。

Test用Roleにdeploy権限やsecret取得権限がないか。

Build用Roleに本番deploy権限がないか。

Deploy用Roleがdeploy対象リソースに限定されているか。

CodePipeline Service Roleが過剰な権限を持っていないか。

Secrets ManagerやParameter Storeを読めるRoleを限定しているか。

です。

---

## Stage / Projectの分離


次にStage / Projectの分離です。

確認ポイントは、

Test StageとDeploy Stageを分離していること。

npm ciやgradle buildをするProjectに不要なSecretがないこと。

Deploy Stageはビルド済みArtifactを受け取る構成になっていること。

Deploy Stageではnpm ciやgradle buildを実行していないこと。

Deploy前にManual approvalを設定していることです。

この章で最も重要なのは、

Secretsや本番権限を持つStageで依存ライブラリを実行しないことです。

---

## Secrets


次にSecretsです。

確認ポイントは、

Secretsを最も狭いスコープで設定しているか。

不要なSecretsがないか定期的に棚卸ししているか。

AWS長期アクセスキーではなくCodeBuild Service Roleを使っているか。

外部サービスTokenはSecrets ManagerやParameter Storeで管理しているか。

Secretを読めるRoleをDeploy用やPublish用CodeBuildに限定しているか。

ローテーション手順があるか。

です。

---

## PRとtrust boundary


次はPRと信頼境界です。

確認ポイントは、

外部PRや未信頼branchからSecretsへアクセスできないこと。

未信頼コードを本番権限付きProjectでbuildしていないこと。

PR検証用Projectとリリース用Pipelineを分けていること。

外部からのPRに対するCI実行ポリシーがあることです。

未信頼コードは、

未信頼コードとして扱う必要があります。

---

## 外部ツール・外部スクリプト


次は外部ツール・外部スクリプトです。

確認ポイントは、

外部ツールのversionを固定しているか。

binaryやscriptのchecksumを検証しているか。

latest tagやcurl pipe bashを避けているか。

base imageの信頼性を確認しているか。

base imageやtoolの更新を管理しているか。

不要な外部ツールを使っていないか。

です。

CI/CDで実行する外部コードも、

サプライチェーンの一部です。

---

## Cache


次はCacheです。

Cacheのキーや運用にlockfileの変更を反映しているか。

インシデント時にCacheを削除する手順があるか。

Cacheの有効期間を設定しているか。

Test、Build、DeployでCacheを共有しすぎていないか。

を確認します。

Cacheは高速化のためだけの機能ではなく、

セキュリティ管理の対象です。

---

## リリース経路


最後にリリース経路です。

branch protectionを設定しているか。

required reviewを設定しているか。

CIの成功を必須にしているか。

Source Stageを信頼済みbranchに限定しているか。

deployやpublishにManual approvalを要求しているか。

BuildArtifact以外をDeployしていないか。

を確認します。

### この章のまとめ

チェックリストは、

今日学んだ内容を実践へ落とし込むためのものです。

ぜひ自分たちのPipelineでも確認してみてください。

---

# 12. この回で学んだこと


最後に今回の内容を振り返ります。

今日は、

* CI/CDが攻撃者にとって価値の高い理由
* ライブラリ汚染とCI/CDの関係
* IAM権限の最小化
* CodePipelineのStage分離
* CodeBuild ProjectとService Roleの分離
* Secrets管理
* 長期Token削減
* 外部ツール・外部スクリプトの管理
* Cache管理
* リリース経路の保護

について学びました。

ただし、

覚えていただきたいのは個別の設定だけではありません。

この資料全体を貫いている考え方があります。

---

# クロージング


最後に、

この資料全体を一言でまとめます。

今回の資料では、

IAM Role、

Stage分離、

Secrets管理、

CodeBuild Service Role、

外部ツール管理、

Cache管理など、

さまざまな対策を見てきました。

ただし、

覚えていただきたいのは個別の設定ではありません。

この資料全体を貫いている考え方があります。

それは、

「信頼できないものと強い権限を分離する」

という考え方です。

依存ライブラリは信頼しない。

未信頼branchや外部PRは信頼しない。

外部スクリプトや外部ツールも信頼しない。

長期Tokenもできるだけ持たない。

だからこそ、

CodePipelineのStageを分け、

CodeBuild Projectを分け、

Service Roleを分け、

Secretsのスコープを狭め、

Deploy前にManual approvalを置きます。

AWSのサービスや設定項目は今後変わるかもしれません。

しかし、

この設計思想は今後も変わりません。

ぜひ設定方法だけではなく、

設計の考え方として持ち帰っていただければと思います。

以上で発表を終わります。

ありがとうございました。

---

# 想定Q&A

## Q. Build Stageでもnpm ciしていますよね？

A.

はい。

ただし、Build Stageには本番Secretsや本番deploy権限を持たせません。

完全に悪性コードの実行を防ぐのではなく、

実行された場合の被害を限定する考え方です。

---

## Q. Deploy Stageでnpm ciしないのはなぜですか？

A.

Deploy Stageは本番deploy権限やSecretを持つためです。

そこで依存ライブラリのinstallを実行すると、

悪性パッケージが本番権限に触れる可能性があります。

そのため、

Deploy StageではBuild済みArtifactを受け取り、

deployのみを実行します。

---

## Q. CodeBuild Service Roleを使えばSecretsは不要ですか？

A.

すべて不要になるわけではありません。

AWSリソースへのアクセスでは、

長期アクセスキーを減らすことができます。

一方で、

npm publish tokenや外部SaaSのAPI tokenなど、

AWS外の認証情報は残る場合があります。

その場合は、

Secrets ManagerやParameter Storeで管理し、

読めるRoleを限定します。

---

## Q. Manual approvalを入れれば安全ですか？

A.

Manual approvalだけで安全になるわけではありません。

承認前に、

変更内容、Build/Test結果、Deploy対象Artifact、変更元branchを確認する必要があります。

また、

Manual approvalは、

IAM Role分離やSecrets最小化と組み合わせて使うものです。

---

## Q. 外部ツールをversion固定すれば100%安全ですか？

A.

いいえ。

version固定は重要ですが、

固定したバージョン自体に脆弱性が見つかることもあります。

そのため、

checksum検証、digest固定、継続的な更新管理も必要です。

---

## Q. この資料で一番重要なポイントは何ですか？

A.

「信頼できないコードと強い権限を分離すること」です。

Stage分離も、

CodeBuild Service Role分離も、

Secrets管理も、

長期Token削減も、

すべてこの考え方で説明できます。
