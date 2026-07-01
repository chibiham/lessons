# 第3回：Java / Kotlin / Gradle / Maven — バックエンド開発のサプライチェーンリスク

## この回の目的

Java / Kotlin開発者が日常的に扱うGradle・Mavenの依存関係管理を題材に、JVM系特有のサプライチェーンリスクを理解する。まずGradle/Mavenがそもそも何のためのツールであり、依存関係管理がその中でどう位置づけられるのかを整理したうえで、npmとの違いを明確にし、build.gradle.ktsやpom.xmlに当てはめて考えられるようにし、Java/Kotlin依存関係レビュー観点を作成する。

---

## 1. Gradle/Mavenとは何か — ビルドシステムと依存関係解決

### 1.1 そもそも何をするためのツールか

GradleもMavenも、第一義的には**ビルドシステム（ビルド自動化ツール）**である。ソースコードのコンパイル、テストの実行、パッケージング（jar/war生成）、そして配布（deploy）までの一連の**ビルドライフサイクル**を管理することが本来の役割であり、依存関係管理（外部ライブラリの取得）は、そのビルドを成立させるために内蔵された機能の一つに過ぎない。

```
Gradle/Mavenの責務:
  ソースコンパイル → テスト実行 → パッケージング → 検証 → インストール → デプロイ
                                ↑
                  依存関係解決はこのライフサイクルを支える一機能
```

これはnpmと対比すると分かりやすい。npmは第一義的には**パッケージマネージャ（レジストリクライアント）**であり、ビルド（バンドル、トランスパイル）はwebpackやVite、tscといった別のツールに委譲される。npm自身はビルドの手順そのものには関知しない。

| | npm | Gradle / Maven |
|---|---|---|
| 第一義的な役割 | パッケージマネージャ | ビルドシステム |
| 依存関係管理の位置づけ | コア機能そのもの | ビルドライフサイクルを支える一機能 |
| ビルド処理（コンパイル等） | 対象外。別ツールに委譲 | 標準機能として内蔵 |

この前提を持っておくと、後述する「なぜGradle pluginやannotation processorが依存関係と別枠で厳格にレビューされるべきか」が理解しやすくなる。**依存関係の取得はビルドの一部でしかなく、ビルドという行為自体がより大きな権限を持つ**、という構造がJVM系の設計の根底にある。

### 1.2 Mavenの設計思想 — 宣言的な固定ライフサイクル

Mavenは、`pom.xml`という**宣言的なXML**でプロジェクトを記述する。ビルドは以下の固定されたフェーズ（lifecycle phase）を順番に通過する。

```
validate → compile → test → package → verify → install → deploy
```

```xml
<!-- pom.xml -->
<project>
    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0</version>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
    </dependencies>
</project>
```

`pom.xml`自体には、任意のロジックを記述するスクリプティング機能がない。各フェーズで何が実行されるかは、そのフェーズに紐づけられた**plugin**が決める。「Convention over Configuration（設定より規約）」の思想に基づき、標準的なディレクトリ構成（`src/main/java`など）に従えば、最小限の設定でビルドが成立するように設計されている。

### 1.3 Gradleの設計思想 — タスクグラフと実行可能なDSL

Gradleは、`build.gradle`（Groovy）または`build.gradle.kts`（Kotlin）という**実行可能なDSL（コード）**でビルドを記述する。固定のライフサイクルフェーズではなく、**タスク（Task）とその依存関係からなるグラフ（DAG）**としてビルドをモデル化する。

```kotlin
// build.gradle.kts — これはコードであり、Gradle実行時にKotlin/Groovyとして評価される
tasks.register("hello") {
    doLast {
        println("Hello, ${System.getenv("USER")}")
    }
}
```

pluginはタスクを追加し、タスク間の依存関係を定義する。柔軟性が高い反面、**ビルドスクリプト自体が任意のコードを実行できる**という特性を持つ。また、incremental build・build cache・configuration cacheなど、ビルドパフォーマンスの最適化機構も充実している。

### 1.4 Gradle / Mavenの主な違い

| 観点 | Maven | Gradle |
|------|-------|--------|
| 設定ファイルの形式 | 宣言的XML（`pom.xml`） | 実行可能DSL（Groovy/Kotlin、`build.gradle(.kts)`） |
| ビルドモデル | 固定ライフサイクル（フェーズ） | タスクグラフ（DAG、任意に組み替え可能） |
| 拡張の主な手段 | pluginをフェーズにbind | plugin＋build script内への直接記述 |
| ビルドスクリプト自体のコード実行 | 不可（pom.xmlはデータであり実行ロジックを持たない） | 可能（build.gradle.kts自体がプログラムである） |
| パフォーマンス最適化 | 限定的 | incremental build, build cache, configuration cache |
| 典型的な採用領域 | エンタープライズ、レガシー資産の多いJavaプロジェクト | Android公式ビルドツール、モダンなJava/Kotlinプロジェクト |

### 1.5 この違いが持つセキュリティ上の意味

この設計思想の違いは、サプライチェーンリスクの観点でも無視できない差を生む。

- **Maven**: `pom.xml`自体は宣言的データなので、`pom.xml`の変更だけでビルド時に任意コードが実行されることはない。コード実行はあくまでpluginの追加・変更を経由する。したがって「pluginの追加・変更」を見張ることが、Mavenにおけるビルド時コード実行リスクのレビューのほぼ全てになる。
- **Gradle**: `build.gradle.kts`自体が実行可能なコードであるため、**新しいplugin/dependencyを何も追加しなくても、build script内に直接悪性ロジックを書き込むだけでビルド時に任意コードを実行できる**（例: `doLast`ブロック内で環境変数を読み取り外部送信するなど）。これはMavenには存在しない、Gradle固有の追加的な攻撃対象面である。

そのため、Gradleを使うプロジェクトでは、依存関係やplugin追加のレビューに加えて、**`build.gradle.kts`自体の差分レビュー**が独立した重要観点になる。この章以降で扱うGradle plugin・annotation processor・repository設定などのリスクは、いずれも「依存解決の一部機能」として組み込まれたものであり、Gradle/Mavenが本質的にビルドシステムであるという前提の上に成り立っている。

---

## 2. npmとJVM系のリスクの違い

### 2.1 install時のコード実行

| 項目 | npm | Gradle / Maven |
|------|-----|---------------|
| install時のスクリプト実行 | あり（lifecycle scripts） | 通常のlibrary dependencyではなし |
| ビルド時のコード実行 | webpack / Vite等のビルドツール | Gradle plugin, Maven plugin, annotation processor |
| 攻撃のタイミング | `npm install`時 | `gradle build` / `mvn compile`時 |

JVM系では、通常のlibrary dependency（`implementation`や`<dependency>`で追加するもの）がinstall時にスクリプトを実行することはない。

**しかし、Gradle plugin、Maven plugin、annotation processorは、ビルド時にコードを実行する。** これらはnpmのinstall scriptとは異なる経路だが、同等以上のリスクを持つ。

### 2.2 リスクの所在の違い

```
npm系のリスク:
  npm install → install script実行 → 認証情報窃取
  ↑ 依存追加のタイミングで攻撃が成立

JVM系のリスク:
  gradle build / mvn compile → plugin実行 → 認証情報窃取
  gradle build / mvn compile → annotation processor実行 → コード生成時に悪性コード注入
  ↑ ビルドのタイミングで攻撃が成立
```

npmでは「install時に何が実行されるか」が焦点だが、JVM系では「ビルド時に何が実行されるか」が焦点になる。

---

## 3. Gradle pluginのリスク

### 3.1 Gradle pluginとは何か

Gradle pluginは、ビルドプロセスを拡張するためのコンポーネントである。

```kotlin
// build.gradle.kts
plugins {
    kotlin("jvm") version "2.0.0"
    kotlin("plugin.spring") version "2.0.0"
    id("org.springframework.boot") version "3.3.0"
    id("io.spring.dependency-management") version "1.1.5"
    id("com.google.protobuf") version "0.9.4"
}
```

**Gradle pluginは、ビルドスクリプトのクラスパスに入り、ビルドプロセス中に任意のコードを実行できる。** これはnpmのdevDependenciesとは比較にならないほど強い権限を持つ。

### 3.2 pluginが持つ権限

Gradle pluginは以下のことが可能である。

- ファイルシステムへの読み書き
- 環境変数の参照
- ネットワークアクセス
- プロセスの起動
- Gradleのビルド設定の変更
- 他のtaskの追加・変更

```
Gradle pluginが実行される流れ:
  1. gradle build を実行
  2. build.gradle.kts を評価
  3. plugins ブロックで指定された plugin を取得
  4. plugin のコードが実行される ← ここで任意コード実行が可能
  5. 通常のビルドが進行
```

悪性のGradle pluginは、ビルド時に環境変数や`~/.gradle/gradle.properties`の認証情報を読み取り、外部に送信できる。

### 3.3 Gradle plugin追加は通常のdependency追加より厳しく見るべき理由

```kotlin
// 通常のdependency — 実行時にアプリケーションコードから使う
dependencies {
    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.0")
}

// Gradle plugin — ビルド時にビルドプロセス自体の権限で動作する
plugins {
    id("some-gradle-plugin") version "1.0.0"
}
```

| 観点 | 通常のdependency | Gradle plugin |
|------|-----------------|---------------|
| 実行タイミング | アプリケーション実行時 | ビルド時 |
| 実行環境 | アプリケーションのサンドボックス内 | ビルドプロセス（制限なし） |
| アクセスできるもの | アプリケーションに渡された情報 | ファイルシステム、環境変数、ネットワーク |
| CI/CDでの影響 | deployされたアプリに限定 | CI/CD環境のsecrets全体 |

**Gradle pluginの追加は、通常のlibrary dependencyの追加より厳格にレビューすべきである。**

---

## 4. Maven pluginのリスク

### 4.1 Maven pluginの権限

Maven pluginも、ビルドのライフサイクルにバインドされ、ビルド時にコードを実行する。

```xml
<!-- pom.xml -->
<build>
    <plugins>
        <plugin>
            <groupId>org.apache.maven.plugins</groupId>
            <artifactId>maven-compiler-plugin</artifactId>
            <version>3.13.0</version>
        </plugin>
        <plugin>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-maven-plugin</artifactId>
            <version>3.3.0</version>
        </plugin>
    </plugins>
</build>
```

Maven pluginはビルドの各フェーズ（compile, test, package, install, deploy）にバインドされ、そのフェーズで任意のコードを実行できる。

### 4.2 Maven Wrapperの安全性

Maven WrapperはGradle Wrapperと同様に、プロジェクトに必要なMavenバージョンを固定し自動ダウンロードする仕組みである。

```
.mvn/
  wrapper/
    maven-wrapper.properties  ← ダウンロード元URL
```

`maven-wrapper.properties`のダウンロードURLが改ざんされると、悪性のMavenバイナリが取得される可能性がある。Gradle Wrapperについても同様のリスクがある。

---

## 5. annotation processorのリスク

### 5.1 annotation processorとは

annotation processorは、コンパイル時にアノテーションを解析してコードを生成する仕組みである。

```kotlin
// build.gradle.kts
dependencies {
    kapt("org.mapstruct:mapstruct-processor:1.5.5.Final")
    kapt("org.projectlombok:lombok:1.18.32")
    annotationProcessor("org.mapstruct:mapstruct-processor:1.5.5.Final")
}
```

代表的なannotation processor：

| ツール | 用途 |
|--------|------|
| Lombok | ボイラープレートコード生成 |
| MapStruct | DTO変換コード生成 |
| Dagger/Hilt | DI（依存性注入）コード生成 |
| Room (Android) | データベースアクセスコード生成 |
| KSP (Kotlin Symbol Processing) | Kotlin向けコード生成 |

### 5.2 annotation processorが持つ権限

annotation processorは**コンパイラのプロセス内で動作する**。

```
annotation processorの実行環境:
  - コンパイラプロセス内で動作
  - ソースコード全体にアクセス可能
  - ファイルシステムへの読み書きが可能
  - 新しいソースファイルを生成可能
  - 環境変数にアクセス可能
```

悪性のannotation processorが含まれた場合、コンパイル時に以下が可能：

- ソースコードの読み取り（知的財産の窃取）
- 生成コードへの悪性コードの注入
- 環境変数や認証情報の窃取
- ファイルシステムへのアクセス

**annotation processorの追加も、Gradle pluginと同様に厳格にレビューすべきである。**

---

## 6. Maven Repositoryの概要とリスク

### 6.1 Mavenリポジトリとは何か — ビルドツールではなく配布フォーマットの規約

「Maven」という名前は、ビルドツールとリポジトリのフォーマットの両方に使われている。ここで扱う「Mavenリポジトリ」は**ビルドツールとしてのMavenとは独立した、成果物配置の規約（フォーマット仕様）**であり、Gradleを含むJVM系のほぼすべてのツールがこの規約に従ったリポジトリを読みに行く。

```
<groupIdをパス化したもの>/<artifactId>/<version>/
  <artifactId>-<version>.jar
  <artifactId>-<version>.pom
  <artifactId>-<version>.jar.sha1 / .sha256 / .asc（署名）
  maven-metadata.xml（バージョン一覧など）
```

Mavenリポジトリはnpm registryのような動的なWeb APIではなく、**単純な静的ファイルサーバー**である。HTTPのGETリクエストでファイルを取得するだけであり、専用のプロトコルやAPIを必要としない。

```kotlin
// build.gradle.kts — Gradle自体はMavenツールを使わないが、
// 「Mavenリポジトリ形式」のレジストリをそのまま参照する
repositories {
    mavenCentral()
    maven { url = uri("https://jitpack.io") }
}
```

### 6.2 座標系（GAV coordinates）による名前空間

Mavenエコシステムは、**groupId : artifactId : version（GAV）**という3つ組で全世界のライブラリを一意に識別する。

```
com.fasterxml.jackson.core : jackson-databind : 2.17.0
└─ groupId ─────────────┘  └─ artifactId ──┘  └version┘
```

`groupId`は、npmのパッケージ名のようなフラットな早い者勝ちの名前空間ではなく、**ドメイン名を逆順にしたもの**を使う強い慣習がある。Maven Centralに新しいgroupIdで初めて公開する際は、そのドメインまたはGitHub組織の所有権を証明する必要がある。これにより、他人のドメインを騙ったgroupIdを勝手に名乗ることが構造的に難しくなっている。

### 6.3 1つのGAVが指す成果物一式

npmの1パッケージ1バージョンは基本的に1つのtarballだが、Mavenの1つのGAVは**複数の関連ファイル一式**を指す。

```
jackson-databind-2.17.0.jar          ← 本体（コンパイル済みバイトコード）
jackson-databind-2.17.0.pom          ← メタデータ（依存関係、ライセンス等）
jackson-databind-2.17.0-sources.jar  ← ソースコード（任意）
jackson-databind-2.17.0-javadoc.jar  ← Javadoc（任意）
jackson-databind-2.17.0.jar.sha1     ← チェックサム
jackson-databind-2.17.0.jar.asc      ← PGP署名
jackson-databind-2.17.0.module       ← Gradle Module Metadata（Gradle公開時のみ）
```

`classifier`という仕組みもあり、同じGAVでもOS/アーキテクチャ別に複数のjarを配置できる（例: `netty-transport-native-epoll`のLinux/x86_64向けartifact）。JNIを使うネイティブライブラリは、install時にコンパイルするのではなく、この仕組みで事前ビルド済みのバイナリを配布している。

### 6.4 公開の不変性（イミュータビリティ）

Maven Centralの重要な特性として、**一度publishされたGAV（リリースバージョン）は、原則として上書き・削除ができない**ことが挙げられる。

| 項目 | npm | Maven Central |
|---|---|---|
| 同一バージョンの再公開 | 一定条件下で`unpublish`可能 | リリースバージョンは原則不可能 |
| 過去の障害事例 | `left-pad`事件（作者のunpublishで依存プロジェクトが軒並み壊れた） | 構造上、この種の事件は起きにくい設計 |

このイミュータビリティは、SNAPSHOTバージョンには適用されない。

```
リリースバージョン（例: 2.17.0）→ 公開後は不変
SNAPSHOTバージョン（例: 2.17.0-SNAPSHOT）→ 可変（何度でも上書き可能）
```

**Maven Centralの「安全性」は、リリースバージョンがイミュータブルであることに強く依存している。** SNAPSHOTだけがこの保証の外にある特殊な存在であり、この後の7章で扱うSNAPSHOTのリスクは、この不変性の欠如に起因する。

### 6.5 リポジトリの階層とdependency confusionのリスク

```
                 ┌─────────────────────┐
                 │   Maven Central       │ ← 権威あるパブリックリポジトリ
                 └──────────┬───────────┘
                            │ mirror / proxy
                 ┌──────────▼───────────┐
                 │ Nexus / Artifactory   │ ← 社内リポジトリマネージャ
                 │（Centralのキャッシュ + 社内artifact）│
                 └──────────┬───────────┘
                            │
                 ┌──────────▼───────────┐
                 │ 開発者のローカル（~/.m2）│
                 └───────────────────────┘
```

社内でNexus/Artifactoryを使う場合、パブリックリポジトリ（Maven Central）と社内プライベートリポジトリの両方を参照するのが一般的である。ここで問題になるのが**dependency confusion（依存関係の混同）攻撃**である。

```
dependency confusionの成立条件:
  1. 社内で private な groupId（例: com.mycompany.internal-lib）を使っている
  2. その groupId が Maven Central には公開されていない（と攻撃者が把握する）
  3. 攻撃者が同じ groupId:artifactId で、社内バージョンより新しいバージョンを
     Maven Central に公開する
  4. リポジトリの優先順位設定次第で、社内向けの正規artifactではなく
     攻撃者が公開した公開版を取得してしまう
```

これはnpm/PyPIで実際に被害が確認された攻撃手法（2021年、Alex Birsan氏による報告）と同じ構造がMaven/Gradleにも当てはまる。対策としては、`repositories`ブロックでの参照順序・スコープの明示指定（社内groupIdはprivateリポジトリからのみ取得するよう固定する）や、社内groupIdをMaven Centralに先んじて予約・公開しておくことが有効である。

### 6.6 npmレジストリとの対比まとめ

| 観点 | npm registry | Maven repository |
|---|---|---|
| 実体 | 動的なWeb API | 静的ファイルサーバー |
| 名前空間 | フラット・早い者勝ち | groupId＝ドメイン所有権ベースの予約制 |
| 単位 | パッケージ1つのtarball | GAV座標につきjar/pom/署名等の一式 |
| 公開の可逆性 | 一定条件下でunpublish可能 | リリースバージョンはイミュータブル |
| 主なリスク | typosquatting、install scriptによるコード実行 | name squatting、dependency confusion |

---

## 7. repository設定のリスク

### 7.1 Gradleのrepository設定

```kotlin
// build.gradle.kts
repositories {
    mavenCentral()
    google()
    maven {
        url = uri("https://jitpack.io")
    }
    maven {
        url = uri("https://some-company-repo.example.com/maven")
    }
    mavenLocal()
}
```

repository設定は、依存関係をどこから取得するかを決める。

### 7.2 repositoryに関するリスク

#### 信頼できないrepositoryの追加

PRで新しいrepositoryが追加されている場合、そのrepositoryの信頼性を確認する必要がある。

```kotlin
// 要確認：なぜこのrepositoryが必要か
maven {
    url = uri("https://unknown-repo.example.com/maven")
}
```

Gradle公式ドキュメントでは、repository shadowingのリスクに触れている。複数のrepositoryが設定されている場合、上位のrepositoryに同名・同バージョンのartifactを配置することで、正規のartifactを差し替えることが可能になる。

#### mavenLocalのリスク

`mavenLocal()`は、開発者端末の`~/.m2/repository`を参照する。

```
mavenLocal()のリスク:
  - ローカルにキャッシュされたartifactが改ざんされている可能性
  - ローカルの状態に依存するため、再現性がない
  - CI/CDでmavenLocal()を使うと、ビルドの再現性と安全性が低下する
```

**CI/CDではmavenLocal()を使うべきではない。** 開発時であっても、必要な場合を除き使用を避ける。

#### name squatting

Gradle公式ドキュメントでは、name squattingのリスクにも触れている。Maven CentralやGradle Plugin Portalに、既存の有名なパッケージに似た名前のartifactを公開する攻撃である。npmのtyposquattingと同様のリスクがJVM系にも存在する。

### 7.3 Mavenのrepository設定

```xml
<!-- pom.xml -->
<repositories>
    <repository>
        <id>central</id>
        <url>https://repo.maven.apache.org/maven2</url>
    </repository>
    <repository>
        <id>company-repo</id>
        <url>https://some-company-repo.example.com/maven</url>
    </repository>
</repositories>
```

Mavenでも同様に、信頼できないrepositoryの追加や、repository設定の変更には注意が必要である。

---

## 8. SNAPSHOTと動的バージョン

### 8.1 SNAPSHOT dependencyのリスク

```kotlin
// SNAPSHOT version
dependencies {
    implementation("com.example:some-lib:1.0.0-SNAPSHOT")
}
```

SNAPSHOT versionは、同じバージョン番号でも中身が変わる可能性がある。

```
SNAPSHOT の動作:
  1.0.0-SNAPSHOT を依存に追加
  → 取得するたびに最新のSNAPSHOT artifactを確認
  → 同じバージョン番号でも中身が異なる可能性がある
  → ビルドの再現性がない
```

**攻撃者がSNAPSHOT repositoryに書き込めれば、同じバージョン番号のまま悪性artifactに差し替えられる。**

### 8.2 動的バージョンのリスク

```kotlin
// 動的バージョン指定（危険）
dependencies {
    implementation("com.example:some-lib:1.+")
    implementation("com.example:some-lib:latest.release")
}
```

動的バージョン指定は、解決のたびに異なるバージョンが選択される可能性がある。lockfileで固定していない場合、攻撃者がバージョン範囲内の新バージョンを公開するだけで取り込まれる。

---

## 9. Dependency Verification

### 9.1 GradleのDependency Verification

GradleのDependency Verificationは、依存成果物やmetadata、pluginなどについてchecksumやsignatureを用いて検証する仕組みを提供している。

```
gradle/
  verification-metadata.xml  ← checksumやsignatureの情報
```

#### checksum verification

```xml
<!-- gradle/verification-metadata.xml -->
<verification-metadata>
    <components>
        <component group="com.fasterxml.jackson.core" 
                   name="jackson-databind" 
                   version="2.17.0">
            <artifact name="jackson-databind-2.17.0.jar">
                <sha256 value="abc123..." origin="Maven Central"/>
            </artifact>
        </component>
    </components>
</verification-metadata>
```

checksumを記録しておくことで、依存成果物が差し替えられた場合に検出できる。

#### signature verification

PGP署名による検証も可能である。artifactの署名を検証することで、正規のmaintainerが公開したものであることを確認できる。

### 9.2 Dependency Verificationの導入

```bash
# verification-metadata.xml の生成
./gradlew --write-verification-metadata sha256

# 署名検証も含める場合
./gradlew --write-verification-metadata sha256,pgp
```

生成されたverification-metadata.xmlをリポジトリにcommitし、依存関係の更新時に差分を確認する。

**新しい依存関係を追加したとき、verification-metadata.xmlに新しいエントリが追加される。このエントリが正当なものであることを確認する。**

### 9.3 Mavenでの依存検証

Mavenには、Gradleほど統合されたDependency Verification機能はないが、以下の方法で検証できる。

- maven-enforcer-pluginで依存関係の制約を設定する
- checksumの検証（Mavenはデフォルトでchecksumを検証する）
- `<repositories>`の設定でHTTPS通信を強制する

---

## 10. SCAツール — OWASP Dependency-Check

### 10.1 OWASP Dependency-Checkとは

OWASP Dependency-Checkは、プロジェクトの依存関係を分析し、CVEなどの既知脆弱性に関連づけてレポートするSCAツールである。Maven plugin、Gradle plugin、CLI、Jenkins、GitHub Actions、Azure DevOpsなどの連携が提供されている。

### 10.2 Gradleでの導入

```kotlin
// build.gradle.kts
plugins {
    id("org.owasp.dependencycheck") version "10.0.0"
}

dependencyCheck {
    failBuildOnCVSS = 7.0f  // CVSS 7.0以上で失敗
    formats = listOf("HTML", "JSON")
}
```

```bash
# 脆弱性チェックの実行
./gradlew dependencyCheckAnalyze
```

### 10.3 Mavenでの導入

```xml
<!-- pom.xml -->
<build>
    <plugins>
        <plugin>
            <groupId>org.owasp</groupId>
            <artifactId>dependency-check-maven</artifactId>
            <version>10.0.0</version>
            <configuration>
                <failBuildOnCVSS>7</failBuildOnCVSS>
            </configuration>
        </plugin>
    </plugins>
</build>
```

```bash
# 脆弱性チェックの実行
mvn dependency-check:check
```

### 10.4 SCAツールの限界

npm auditと同様に、SCAツールは**既知の脆弱性**のみを検出する。

- 意図的に仕込まれた悪性コード（CVEが割り振られていない）は検出できない
- 0-day脆弱性は検出できない
- false positive（誤検知）も発生する

SCAツールは重要な防御層だが、それだけでは不十分であることを理解しておく。

---

## 11. Gradle / Maven固有の追加観点

### 11.1 buildSrcとincluded build

```
buildSrc/
  src/main/kotlin/
    convention-plugins.gradle.kts  ← ビルドロジックのカスタマイズ
```

buildSrcやincluded buildは、プロジェクト固有のビルドロジックを定義する場所である。ここに外部依存関係を追加する場合、それはビルドプロセスの一部として動作する。

### 11.2 Gradle Wrapperの安全性

```
gradle/
  wrapper/
    gradle-wrapper.jar         ← Gradleのダウンロードと起動を行うJAR
    gradle-wrapper.properties  ← ダウンロード元URL、バージョン
```

`gradle-wrapper.jar`はリポジトリにcommitされるバイナリファイルである。このファイルが改ざんされると、悪性のGradleが実行される。

**Gradle Wrapper JARの正当性は確認すべきである。** Gradleは公式にWrapper JARの検証方法を提供している。

```bash
# Gradle Wrapper JARの検証
./gradlew wrapper --gradle-version=8.8 --verify
```

GitHub Actionsでは、`gradle/actions/wrapper-validation`アクションを使ってWrapper JARの正当性を検証できる。

### 11.3 settings.gradle.ktsのpluginManagement

```kotlin
// settings.gradle.kts
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        maven {
            url = uri("https://some-repo.example.com/")
        }
    }
}
```

pluginManagementのrepository設定も、通常のrepository設定と同様にレビュー対象である。

---

## 12. Java/Kotlin依存関係レビュー観点

この回の成果物として、以下のレビュー観点を共有する。

### 依存関係の追加・更新時

```
□ 新しいrepositoryが追加されていないか
  - 追加されている場合、そのrepositoryの信頼性を確認したか
  - 社内groupIdがdependency confusionの標的になり得ないか
□ mavenLocal()がCI/CDで使われていないか
□ SNAPSHOT versionや動的バージョンを使っていないか
□ Gradle plugin追加を通常のdependencyより厳格にレビューしたか
  - pluginの提供元は信頼できるか
  - Gradle Plugin Portalでの情報を確認したか
□ annotation processor追加を確認したか
  - kaptやannotationProcessorの追加は厳格にレビュー
□ Dependency Verificationの対象か
  - verification-metadata.xmlに新しいエントリが追加されているか
  - エントリが正当か確認したか
□ OWASP Dependency-Check等のSCAツールで既知脆弱性を確認したか
□ transitive dependencyの変化を確認したか
```

### ビルド設定のレビュー

```
□ build.gradle.kts / pom.xml の変更に不要なrepository追加がないか
□ settings.gradle.kts の pluginManagement 変更を確認したか
□ buildSrc / included build の依存関係変更を確認したか
□ Gradle Wrapper / Maven Wrapper のバージョン変更を確認したか
□ Gradle Wrapper JAR の正当性を検証したか
```

### CI/CDでのGradle/Maven運用

```
□ CI/CDでmavenLocal()を使っていないか
□ SNAPSHOT dependencyをCI/CDで使っていないか
□ dependency cacheの安全性を確認しているか
□ Dependency Verificationを有効にしているか
□ SCAツールをCIに組み込んでいるか
□ Gradle Wrapperの検証をCIに組み込んでいるか
```

---

## 13. まとめと次回への接続

### この回で学んだこと

1. **Gradle/Mavenはビルドシステムである** — 依存関係管理はビルドライフサイクルを支える一機能に過ぎず、Maven（宣言的・固定ライフサイクル）とGradle（実行可能DSL・タスクグラフ）で設計思想が異なる
2. **npmとJVM系のリスクの違い** — install時ではなくビルド時に攻撃が成立する
3. **Gradle plugin / Maven pluginの権限** — ビルドプロセス内で任意コード実行が可能
4. **annotation processorのリスク** — コンパイラプロセス内で動作し、広範な権限を持つ
5. **Maven Repositoryの概要とリスク** — GAV座標、静的ファイルサーバーとしての規約、リリースバージョンのイミュータビリティ、dependency confusionのリスク
6. **repository設定のリスク** — 信頼できないrepository、mavenLocal、repository shadowingの問題
7. **SNAPSHOTと動的バージョンのリスク** — ビルドの再現性と安全性の問題
8. **Dependency Verification** — checksumやsignatureによる依存成果物の検証
9. **SCAツール** — OWASP Dependency-Checkによる既知脆弱性の検出

### 次回予告：第4回 CI/CD・secrets・リリース経路

次回は、第2回・第3回で学んだnpm系・JVM系のリスクが、CI/CD上でどのように被害拡大するかを扱う。

- CI/CDが攻撃者にとって価値の高い理由
- GitHub Actions workflowのpermissions
- write権限の最小化
- deploy jobとtest jobの分離
- secretsのスコープ管理
- OIDCによる長期token削減
- third-party actionsの固定方法
- CI/CD防御チェックリストの作成

---

## 確認問題

1. Gradle/Mavenが「パッケージマネージャ」ではなく「ビルドシステム」である理由と、その中で依存関係管理がどう位置づけられるかを説明できるか
2. Maven（宣言的XML・固定ライフサイクル）とGradle（実行可能DSL・タスクグラフ）の設計思想の違いと、それがセキュリティ上どう影響するかを説明できるか
3. npmのinstall scriptとGradle pluginのリスクの違いを説明できるか
4. Gradle pluginの追加を通常のdependencyの追加より厳格にレビューすべき理由を説明できるか
5. annotation processorが持つ権限と、そのリスクを説明できるか
6. mavenLocal()をCI/CDで使うべきでない理由を説明できるか
7. Dependency Verificationの目的と仕組みを説明できるか
8. SCAツールの限界を説明できるか
