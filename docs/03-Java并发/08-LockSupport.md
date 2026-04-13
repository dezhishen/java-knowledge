# LockSupport
> LockSupport是锁中的基础，是一个提供锁机制的工具类。

LockSupport用来创建锁和其他同步类的基本线程阻塞原语。简而言之，当调用LockSupport.park时，表示当前线程将会等待，直至获得许可，当调用LockSupport.unpark时，必须把等待获得许可的线程作为参数进行传递，好让此线程继续运行。

## 设计理念
核心是基于信标/许可（Permit）机制的线程阻塞与唤醒，它实现了一种类似于“信号量（Semaphore）”的先来先得，允许乱序通知的线程停顿/恢复模型。
### 基本设计理念
- park()：让当前线程“挂起”，进入阻塞状态，直到被唤醒（unpark）。
- unpark(Thread t)：唤醒指定线程，如果这个线程尚未被挂起（还未执行 park），相当于提前发了“许可”，线程到时候再 park 会立即通过。
- blocker: blocker 参数只是“标记”，和阻塞机制本身无关。这个 blocker 对象用于调试和工具支持，并不会影响挂起/唤醒的行为。

## 核心函数
### park
```java
public native void park(boolean isAbsolute, long time);
```

park函数，阻塞线程，并且该线程在下列情况发生**之前**都会被阻塞: ① 调用unpark函数，释放该线程的许可。② 该线程被中断。③ 设置的时间到了。并且，当time为绝对时间时，isAbsolute为true，否则，isAbsolute为false。当time为0时，表示无限等待，直到unpark发生。

### park函数有两个重载版本，方法摘要如下
```java
public static void park();
public static void park(Object blocker);
```

说明: 两个函数的区别在于park()函数没有没有blocker，即没有设置线程的parkBlocker字段。park(Object)型函数如下。

```java
public static void park() {
    U.park(false, 0L);
}
// ...
public static void park(Object blocker) {
    // 获取当前线程
    Thread t = Thread.currentThread();
    // 设置Blocker
    setBlocker(t, blocker);
    // 获取许可
    U.park(false, 0L);
    // 重新可运行后再此设置Blocker
    setBlocker(t, null);
}
// ...
private static void setBlocker(Thread t, Object arg) {
    U.putReferenceOpaque(t, PARKBLOCKER, arg);
}

// ...
public static Object getBlocker(Thread t) {
    if (t == null)
        throw new NullPointerException();
    return U.getReferenceOpaque(t, PARKBLOCKER);
}

```

说明: 调用park函数时，首先获取当前线程，然后设置当前线程的parkBlocker字段，即调用setBlocker函数，之后调用Unsafe类的park函数，之后再调用setBlocker函数。

那么问题来了，为什么要在此park函数中要调用两次setBlocker函数呢? 原因其实很简单，调用park函数时，当前线程首先设置好parkBlocker字段，然后再调用Unsafe的park函数，此后，当前线程就已经阻塞了，等待该线程的unpark函数被调用，所以后面的一个setBlocker函数无法运行，unpark函数被调用，该线程获得许可后，就可以继续运行了，也就运行第二个setBlocker，把该线程的parkBlocker字段设置为null，这样就完成了整个park函数的逻辑。

如果没有第二个setBlocker，那么之后没有调用park(Object blocker)，而直接调用getBlocker函数，得到的还是前一个park(Object blocker)设置的blocker，显然是不符合逻辑的。总之，必须要保证在park(Object blocker)整个函数执行完后，该线程的parkBlocker字段又恢复为null。所以，park(Object)型函数里必须要调用setBlocker函数两次。
> 当你调用 LockSupport.park(Object blocker)，它告诉 JVM：“我当前因为 blocker 这个对象被挂起”。后续如果用如 jstack、ThreadMXBean 等线程分析工具观察线程状态，“Where blocked?” 就会显示你传入的blocker 对象的信息
### parkNanos
此函数表示在许可可用前禁用当前线程，并**最多等待指定的等待时间**。
```java
public static void parkNanos(Object blocker, long nanos) {
    if (nanos > 0) { // 时间大于0
        // 获取当前线程
        Thread t = Thread.currentThread();
        // 设置Blocker
        setBlocker(t, blocker);
        // 获取许可，并设置了时间
        UNSAFE.park(false, nanos);
        // 设置许可
        setBlocker(t, null);
    }
}
```
> 值为一个正整数，代表最多挂起的"纳秒数"（1秒=10亿纳秒）

### parkUntil
此函数表示在指定的时限前禁用当前线程，除非许可可用, 具体函数如下:

```java
public static void parkUntil(Object blocker, long deadline) {
    // 获取当前线程
    Thread t = Thread.currentThread();
    // 设置Blocker
    setBlocker(t, blocker);
    UNSAFE.park(true, deadline);
    // 设置Blocker为null
    setBlocker(t, null);
}
```
> 让当前线程阻塞直到某个绝对时间点，时间点毫秒时间戳表示。

### unpark
```java
public native void unpark(Thread thread);
//...
public static void unpark(Thread thread) {
    if (thread != null)
        U.unpark(thread);
}
```

unpark函数，释放线程（传入参数）的许可，即激活调用park后阻塞的线程。这个函数不是安全的，调用这个函数时要确保线程依旧存活。
> 此函数表示如果给定线程的许可尚不可用，则使其可用。如果线程在 park 上受阻塞，则它将解除其阻塞状态。否则，保证下一次调用 park 不会受阻塞。如果给定线程尚未启动，则无法保证此操作有任何效果。

## 


