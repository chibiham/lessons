# Null 安全性 - NullPointerException からの解放

## Javaにおける NullPointerException の事例

Javaを書いていると、多くの人が必ず一度はぶつかるのが **NullPointerException（NPE）** です。
変数に `null` が入っているのに気づかずにメソッドを呼び出すと、アプリは即クラッシュしてしまいます。

```java
String name = null;
System.out.println(name.length()); // NullPointerException!
```

この例は単純ですが、実際の開発ではもっと複雑です。
例えばデータベースからユーザーを取ってきて、そこから住所を取り出す処理を考えてみましょう。

```java
User user = repository.findById(123);
String city = user.getAddress().getCity(); // どこでnullになったのか分かりにくい
```

* `user` が見つからず `null` だったのか
* `getAddress()` が `null` を返したのか

どこで `null` が発生したかすぐには分かりません。
スタックトレースだけでは原因を特定できず、「ログを追って、デバッグして、再現して…」とかなりの時間を使うことになっていました。
この問題は長い間「Java開発あるある」として、多くのエンジニアを悩ませてきました。

## Kotlinが解決を目指したこと

Kotlinはこの「NPEとの戦い」を減らすために、言語そのものに **「nullを安全に扱う仕組み」** を組み込みました。
ポイントは、**変数の型レベルで「nullを入れていいかどうか」を区別する** ことです。

```kotlin
var name: String = "Kotlin"
name = null // コンパイルエラーになる

var nullableName: String? = "Kotlin"
nullableName = null // OK
```

* `String` → 「絶対にnullにはならないよ」という約束
* `String?` → 「nullも入るかもしれないよ」という型

Javaでは「nullかどうかは自分で気を付ける」しかありませんでしたが、Kotlinではコンパイラがちゃんと見張ってくれるので、実行する前にエラーに気づけます。
これによって「動かしてみたらクラッシュした」というパターンを大幅に減らせるようになったのです。

## 今日のゴール

* JavaでNPEがどれだけ厄介だったかを知る
* Kotlinが型システムを使ってNPE対策をしている仕組みを理解する
* 実務で「null安全」をどう使っていくかの基本をつかむ


# Nullable型の基本と演算子

## Nullable型と非Nullable型

Kotlinでは、変数に `null` を入れられるかどうかを **型の宣言** で明示します。

```kotlin
var nonNullName: String = "Kotlin"
// nonNullName = null // コンパイルエラー

var nullableName: String? = "Kotlin"
nullableName = null // OK
```

* `String` は「nullを入れてはいけない」型
* `String?` は「nullも入る可能性がある」型

これがJavaとの大きな違いで、Kotlinの「null安全性」を支える基本ルールです。

---

## 安全呼び出し演算子（?.）

`?.` を使うと、変数が `null` かどうかを自動で確認してから処理を進めます。
もし `null` だった場合は、その時点で `null` を返してくれます。

```kotlin
val str: String? = null
val length = str?.length // nullになる。例外は発生しない
```

複数の呼び出しをつなげて書けるのも便利な点です。

```kotlin
val city = user?.address?.city
```

Javaであればネストした `if (x != null)` を何度も書く必要がありますが、Kotlinではシンプルに書けます。

---

## エルビス演算子（?:）

`null` の場合に「代わりの値」を用意したいときは `?:` を使います。
エルビス演算子と呼ばれる理由は、記号が横を向いた顔文字に似ているからです。

```kotlin
val userName: String? = null
val name = userName ?: "ゲスト" // nullなら「ゲスト」が入る
```

実務では「値がなければデフォルトを使う」ケースが多く、よく使われます。

---

## 非null表明（!!）

`!!` をつけると「ここは絶対にnullじゃない！」とコンパイラに伝えられます。
しかしもし実際には `null` だった場合、容赦なく `NullPointerException` が発生します。

```kotlin
val str: String? = null
val length = str!!.length // 実行時にNullPointerException
```

これは危険なため、基本的には使わない方が良いです。
ただし以下のような状況では使われることがあります。

* **テストコード** … データが必ず存在する前提のケース
* **フレームワークの制約** … DIコンテナやライフサイクル管理で必ずセットされる変数

---

## まとめ

* `String` と `String?` の違いを理解する
* `?.` で安全にアクセス、`?:` でデフォルトを設定
* `!!` は最後の手段として使う

これらを組み合わせることで、Kotlinでは「nullが原因のバグ」を大幅に減らすことができます。


# スマートキャストとタイプチェック

## is 演算子による型チェック

Kotlinでは、ある変数が特定の型かどうかを確認するときに `is` 演算子を使います。
Javaの `instanceof` とほぼ同じですが、Kotlinではさらに **「スマートキャスト」** が自動で働きます。

```kotlin
fun printLength(obj: Any) {
    if (obj is String) {
        // この中では obj は自動的に String 型として扱われる
        println(obj.length)
    } else {
        println("Stringではありません")
    }
}
```

上のコードでは `obj` を明示的にキャストする必要がありません。
Kotlinコンパイラが「この条件式の中では安全」と判断して、型を自動で絞り込んでくれます。
これが **スマートキャスト（Smart Cast）** と呼ばれる仕組みです。

---

## as 演算子によるキャスト

`as` を使うと、型を強制的にキャスト（変換）できます。
ただし、もしキャスト先の型と実際の型が違っていた場合は例外が発生します。

```kotlin
val obj: Any = "Hello"
val str = obj as String // OK
val num = obj as Int    // ClassCastException！
```

このように危険なキャストになる可能性があるため、基本的には `as` よりも安全な方法が推奨されます。

---

## 安全なキャスト（as?）

`as?` は「安全なキャスト」を行う演算子です。
キャストできない場合でも例外を出さずに `null` を返してくれるため、安全に扱えます。

```kotlin
val obj: Any = "Hello"
val num: Int? = obj as? Int // 例外は起きず、numはnullになる
```

これにより、`try-catch` でラップしなくても安全にキャスト処理ができます。
`as?` は「キャストできるかわからないけど、とりあえず安全に試したい」ときに便利です。


---

## try-catchなしで安全にキャストできる理由

通常のキャスト演算子 `as` は、型が合わないときに `ClassCastException` を投げます。

```kotlin
val obj: Any = "Hello"
val num: Int = obj as Int // ← 例外：ClassCastException
```

そのため、例外を防ぎたい場合は `try-catch` で囲む必要があります。

```kotlin
val num: Int? = try {
    obj as Int
} catch (e: ClassCastException) {
    null
}
```

しかし、`as?` 演算子はこの処理を内部で自動的に行い、
**例外を出さずに `null` を返す** 仕組みになっています。

```kotlin
val num: Int? = obj as? Int // ← キャスト失敗時はnullを返す
```

つまり、`as?` は「`try-catch` 付きのキャスト」を
**1行で安全に書ける構文糖衣（シンタックスシュガー）** です。

---

### まとめ

| 演算子   | キャスト失敗時の動作                | 例外発生 | 戻り値型      |
| ----- | ------------------------- | ---- | --------- |
| `as`  | `ClassCastException` を投げる | あり   | 非null     |
| `as?` | `null` を返す                | なし   | nullable型 |

---

補足すると、`as?` の戻り値は常に「nullable型」になります。
つまり `Int?` のように **nullを受け取れる変数** に代入する必要があります。


---

以下のように追記すると、コードの意図と挙動が直感的に理解しやすくなります。
（コメントで「どこで何が起きているか」を示しています。）

---

## 契約（contract）による型の絞り込み

Kotlin 1.3 以降では、`kotlin.contracts` という仕組みを使って、**関数内での条件に基づいた型の絞り込み** をコンパイラに伝えることができます。

通常のスマートキャストは `if (x is Type)` のような形でしか働きませんが、契約を使うと **自作の関数** にも「この関数が正常終了したなら、引数は特定の型だ」とコンパイラに教えることができます。

```kotlin
import kotlin.contracts.*

// Any? 型を受け取って、Stringでなければ例外を投げる関数
// ただ例外を投げるだけでなく、"成功時は value は String 型である" という契約を宣言する
fun requireString(value: Any?) {
    contract {
        // 「関数が正常に戻った場合（returns）」は「value が String 型である」と明示
        // ⇒ コンパイラがこの情報を使って型を絞り込める
        returns() implies (value is String)
    }
    // 実際のランタイムチェック：Stringでなければ例外
    if (value !is String) throw IllegalArgumentException("Stringが必要です")
}

fun demo(x: Any?) {
    // requireString() は「正常終了したら x は String」と宣言している
    requireString(x)

    // したがって、ここでは if文なしで x が String として扱われる（スマートキャスト）
    println(x.length) // コンパイルエラーにならない
}
```

---

### 補足説明

通常、コンパイラは関数の中身を解析して「型が保証されている」とは判断しません。
たとえば次のような関数では、型の絞り込みは呼び出し側に伝わりません。

```kotlin
fun checkString(value: Any?) {
    if (value !is String) throw IllegalArgumentException()
}

fun demo(x: Any?) {
    checkString(x)
    println(x.length) // ← コンパイルエラー（x が String と分からない）
}
```

しかし `contract` を使って明示すると、コンパイラが
「この関数が正常終了した＝型チェック済み」と理解できるようになります。

つまり `requireString()` の契約宣言は **コンパイラへの「型保証の約束」** です。


このように「この関数が正常終了したなら、引数はString型だ」とコンパイラに伝えられるため、
`if` 文を使わなくてもスマートキャストと同じように安全な型推論が働きます。

---

## まとめ

* `is` を使うと型チェック＋スマートキャストが自動で効く
* `as` は強制キャストで危険、`as?` は安全キャストで例外を防ぐ
* `contract` を使うと、自作のチェック関数にも型絞り込みを適用できる

これらを組み合わせることで、Kotlinでは「型の安全性」を維持したまま柔軟にキャスト処理が行えます。

# 実践的な null 処理パターン

## Optionalとの比較（Javaとの違い）

Javaでは「値があるかもしれない／ないかもしれない」を表現するために `Optional<T>` クラスが導入されました。
これは「nullを直接返すのは危険だから、値の有無をオブジェクトで包んで伝えよう」という考え方です。

```java
// Java の場合
Optional<User> user = repository.findById(1);
user.ifPresent(u -> System.out.println(u.getName()));
```

一方、Kotlinではこのための特別なクラスは存在しません。
その代わりに、**「null許容型（T?）」** が同じ役割を果たします。

```kotlin
// Kotlin の場合
val user: User? = repository.findById(1)
println(user?.name)
```

つまり、Kotlinの `T?` は「Optional + null安全演算子（?.）」を言語レベルで統合したような設計です。
そのため、KotlinでJavaの `Optional` を多用すると、逆に冗長になります。

```kotlin
// 悪い例：Optionalをそのまま使う
val name = optionalUser.orElse(null)?.name // Optionalとnullの二重構造になる
```

KotlinでOptionalを使うのは、主に「Javaライブラリとの連携が避けられないとき」だけです。
Kotlinネイティブなコードでは `T?` と安全呼び出し演算子を使うのが基本スタイルです。

---

以下のようにコメントを追加すると、コードの意図とKotlinのnull安全の仕組みが視覚的に理解しやすくなります。

---

## null許容型を返すAPIの扱い方

Kotlinでは、null許容型（`?` を付けた型）を返す関数を設計することで、**「呼び出し側がnullを考慮する責任」を明確にできます**。

```kotlin
// User型のリストがあると仮定（例）
val users = listOf(User(1, "Alice"), User(2, "Bob"))

// idを指定してUserを検索する関数
fun findUser(id: Int): User? { 
    // findは見つからない場合nullを返すため、戻り値もUser?になる
    return users.find { it.id == id } // 見つからない場合はnullを返す
}
```

この関数を呼び出す側は、**戻り値がnullかもしれない**ことを明示的に処理しなければなりません。

```kotlin
val user = findUser(1) 
// findUserがnullを返す可能性があるため、userの型はUser?（null許容）

// ?. は「安全呼び出し演算子」：userがnullならnameを読まずにnullを返す
// ?: は「エルビス演算子」：左辺がnullなら右辺を使う
val name = user?.name ?: "ゲスト" 

println(name) // Userが見つかれば名前、見つからなければ「ゲスト」
```

---

### 補足説明

* `User?` は「User または null」の2通りを表す型。
* Kotlinでは、null許容型を返すことで「nullチェックを怠るとコンパイルエラーになる」＝**呼び出し側に安全な設計を強制できる**。
* これにより、Javaのような `NullPointerException` の発生を大幅に防げます。


こうすることで「nullの可能性があること」を型が伝えてくれるため、
呼び出し側での安全な対応を**コンパイル時に強制**できるのが大きなメリットです。

---

## 実務でのnull処理パターン例

### ① 値がなければデフォルト値を返す

```kotlin
val city = user?.address?.city ?: "不明"
```

### ② 処理をスキップする（`let`を活用）

```kotlin
user?.let {
    println("ユーザー名: ${it.name}")
}
```

### ③ 明示的に例外を投げる

```kotlin
val user = findUser(id) ?: throw IllegalArgumentException("ユーザーが存在しません")
```

### ④ 安全に早期リターン

```kotlin
val user = findUser(id) ?: return
println(user.name)
```

---

## まとめ

* Kotlinでは `Optional` の代わりに `T?` 型を使うのが標準
* null許容型を返すことで、呼び出し側に「nullの扱い」を明示的に求められる
* `?:`、`let`、`throw`、`return` などと組み合わせて柔軟にnullを処理できる

Kotlinのnull処理は「避けるもの」ではなく、「安全に扱うための仕組み」として設計されています。


# レガシー Java コードとの連携時の考慮点

## Platform Type（プラットフォーム型）の存在

KotlinとJavaを一緒に使うときに最も注意すべきなのが、**「Platform Type」** です。
これは、**Javaから渡ってきた変数のnull安全性が不明なときに登場する特別な型**です。

```kotlin
val name: String = javaUser.name // ← nameは「String!」というPlatform Type扱いになる
```

`String!` はKotlin内部で使われる型で、
「この値がnullかどうか、Kotlinコンパイラには分からない」という意味を持ちます。

そのため、Platform Typeは **nullチェックを強制されずにコンパイルが通ってしまう** という危険な挙動をします。

```kotlin
val length = javaUser.name.length // コンパイルは通るが、実行時にNPEが起こる可能性あり
```

つまり、Javaから来た値は「安全ではない」と考えるのが基本です。

---

## @Nullable / @NotNull アノテーションの扱い

Javaコード側でアノテーションを適切に付けておくと、Kotlinはそれを理解して安全に扱えます。

```java
public class User {
    @NotNull
    private String name;

    @Nullable
    private String nickname;
}
```

これをKotlinから見ると：

```kotlin
val name: String = user.name        // 非nullとして扱われる
val nickname: String? = user.nickname // null許容として扱われる
```

このように、**Java側にアノテーションが付いていればPlatform Typeを避けられる** ため、
既存コードを修正できる場合はアノテーションの追加が非常に有効です。

---

## JavaメソッドからのOptionalの扱い

Java 8以降では `Optional<T>` を使うケースもあります。
Kotlinでは `Optional` を直接扱えますが、なるべく `T?` に変換して扱うのが自然です。

```kotlin
val name = javaUser.getNameOptional().orElse(null)
println(name?.length)
```

`Optional` を無理にネイティブKotlin風に扱うと複雑になるため、
**「Kotlin側に来たら早めにnull型へ変換」** が基本方針です。

---

## Java → Kotlin の移行時の注意

既存のJavaコードをKotlinに段階的に移行する場合、次のようなトラブルに注意します。

1. **Platform Typeのまま使ってしまう**
   → 明示的に `?` を付けてnullを許容するか、チェックを追加する。

2. **Java側のライブラリがnullを返すことを想定していない**
   → Kotlin側で安全呼び出し（`?.`）やデフォルト値（`?:`）を使ってガードする。

3. **アノテーションが欠けている**
   → `@Nullable` / `@NotNull` を付与して型情報を明確にする。

---

## まとめ

* Javaから渡ってくる型は **Platform Type（String!）** になり、null安全ではない
* Java側で `@Nullable` / `@NotNull` を付けるとKotlinが安全に解釈できる
* `Optional` は `T?` に変換して扱うのがシンプル
* Kotlinへの移行時は「nullの扱い」を明示的に書き直すことが重要

KotlinはJavaと高い互換性を持っていますが、**「null安全性」はKotlinが独自に強化している領域**です。
Javaとの橋渡し部分こそ、最も丁寧なnull対策が求められます。
 
 # 理解度チェック問題（サンプル）

---

## 問題1：安全呼び出しとエルビス演算子の使い分け

次の関数 `printUserCity` は、ユーザーの住所情報を出力する関数です。
ただし `user` も `address` も `null` の可能性があります。
下記の「A〜C」のうち、Kotlinらしい安全な書き方として**最も適切なもの**を選んでください。

```kotlin
data class Address(val city: String)
data class User(val name: String, val address: Address?)

fun printUserCity(user: User?) {
    // A
    println(user.address.city)

    // B
    println(user?.address?.city ?: "不明")

    // C
    if (user != null) println(user.address.city)
}
```

**選択肢:**
A. そのまま呼び出して問題ない
B. 安全呼び出しとエルビス演算子を組み合わせる
C. nullチェックを1段階だけ行えば十分

**正解:** **B**
**解説:** `user` も `address` も `null` の可能性があるため、`?.` を使って安全にアクセスし、値がなければ `"不明"` を返すのがKotlinらしい書き方です。
Aは確実にクラッシュ、Cは`user.address`で再びNPEのリスクがあります。

---

## 問題2：型チェックとスマートキャスト

次の関数 `printLength` は、渡された値の長さを出力しようとしています。
エラーにならずに正しく動作するように修正してください。

```kotlin
fun printLength(value: Any?) {
    if (value is String?) {
        println(value.length) // ← エラー: Smart cast impossible
    }
}
```

**正しい修正版：**

```kotlin
fun printLength(value: Any?) {
    if (value is String && value.isNotEmpty()) {
        println(value.length)
    } else {
        println("文字列ではありません")
    }
}
```

**解説:**
`is String?` は「nullableなStringかどうか」のチェックで、実際にはnullも含まれてしまうためスマートキャストが働きません。
「実際にString型であること」を保証する `is String` に修正することで、`value.length` を安全に呼び出せます。
