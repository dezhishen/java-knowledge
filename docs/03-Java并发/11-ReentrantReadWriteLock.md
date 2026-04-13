# ReentrantReadWriteLock

ReentrantReadWriteLock表示可重入读写锁，ReentrantReadWriteLock中包含了两种锁，读锁ReadLock和写锁WriteLock，可以通过这两种锁实现线程间的同步。

## 读写锁计数方式

```java
    // 高16位为读锁，低16位为写锁，且state此处为无符号
    static final int SHARED_SHIFT   = 16;
    // 读锁单位
    static final int SHARED_UNIT    = (1 << SHARED_SHIFT);
    // 读锁最大数量
    static final int MAX_COUNT      = (1 << SHARED_SHIFT) - 1;
    // 写锁最大数量
    static final int EXCLUSIVE_MASK = (1 << SHARED_SHIFT) - 1;
    // 本地线程计数器
    private transient ThreadLocalHoldCounter readHolds;
    // 缓存的计数器
    private transient HoldCounter cachedHoldCounter;
    // 第一个读线程
    private transient Thread firstReader = null;
    // 第一个读线程的计数
    private transient int firstReaderHoldCount;
```

### 读锁
```java
// +1
state+SHARED_UNIT
// -1
state+SHARED_UNIT
// 获取当前
int readCount = state >>> SHARED_SHIFT;    // 读计数
```
#### 读锁为1时

```text
/// state的值示例，低位，即：HHHH这些是低16的写锁计数
state = 0000 0000 0000 0001 HHHH HHHH HHHH HHHH
// state >>> SHARED_SHIFT：无符号右移16，高位补0
state = 0000 0000 0000 0000 0000 0000 0000 0001
// 即：得到1
```

### 写锁
```java
// +1
state+1
// -1
state-1
// 获取当前
// SHARED_SHIFT = 16
// EXCLUSIVE_MASK= ((1 << SHARED_SHIFT) - 1)
state & EXCLUSIVE_MASK
```

#### 当写锁为1时
```text
/// state的值示例，高位，即：HHHH这些无关紧要的
state = HHHH HHHH HHHH HHHH 0000 0000 0000 0001
// 1 << SHARED_SHIFT 即： 左移16，低位补0： 得到 65536
0000 0000 0000 0001 0000 0000 0000 0000
// 减 1 得掩码： 即： 65535
(1 << 16) - 1 = 0000 0000 0000 0000 1111 1111 1111 1111
// c & ((1 << SHARED_SHIFT) - 1)： 即 c& 65535
c:      HHHH HHHH HHHH HHHH 0000 0000 0000 0000 0001
65535:  0000 0000 0000 0000 0000 1111 1111 1111 1111
result: 0000 0000 0000 0000 0000 0000 0000 0000 0001
// 即：得到1
```

#### 当写锁为0时

```text
/// state的值示例，高位，即：HHHH这些是高16的读锁计数
state = HHHH HHHH HHHH HHHH 0000 0000 0000 0000
// 1 << SHARED_SHIFT 即： 1 << 16 得到 65536
0000 0000 0000 0001 0000 0000 0000 0000
// 减 1 得掩码： 即： 65535
(1 << 16) - 1 = 0000 0000 0000 0000 1111 1111 1111 1111
// c & ((1 << SHARED_SHIFT) - 1)： 即 c& 65535
c:      HHHH HHHH HHHH HHHH 0000 0000 0000 0000 0000
65535:  0000 0000 0000 0000 0000 1111 1111 1111 1111
result: 0000 0000 0000 0000 0000 0000 0000 0000 0000
// 即：得到1
```
## 核心函数
```java
    //  获取读锁数量
    static int sharedCount(int c)    { return c >>> SHARED_SHIFT; }

    // 获取写锁数量
    static int exclusiveCount(int c) { return c & EXCLUSIVE_MASK; }

    protected final boolean isHeldExclusively() {
        // While we must in general read state before owner,
        // we don't need to do so to check if current thread is owner
        return getExclusiveOwnerThread() == Thread.currentThread();
    }
    /**
     * Returns the thread last set by {@code setExclusiveOwnerThread},
     * or {@code null} if never set.  This method does not otherwise
     * impose any synchronization or {@code volatile} field accesses.
     * @return the owner thread
     */
    protected final Thread getExclusiveOwnerThread() {
        return exclusiveOwnerThread;
    }
    /**
     * Sets the thread that currently owns exclusive access.
     * A {@code null} argument indicates that no thread owns access.
     * This method does not otherwise impose any synchronization or
     * {@code volatile} field accesses.
     * @param thread the owner thread
     */
    protected final void setExclusiveOwnerThread(Thread thread) {
        exclusiveOwnerThread = thread;
    }
```


### 获取共享锁（读锁）
> tryReadLock()

```java

/**
 * Performs tryLock for read, enabling barging in both modes.
 * This is identical in effect to tryAcquireShared except for
 * lack of calls to readerShouldBlock.
 */
@ReservedStackAccess
final boolean tryReadLock() {
    Thread current = Thread.currentThread();
    for (;;) {
        // 获取当前状态
        int c = getState();
        // 当前写锁不为0,且当前线程不为持有线程
        if (exclusiveCount(c) != 0 &&
            getExclusiveOwnerThread() != current)
            // 失败
            return false;
        // 只有没有写锁，且总数量不得越界时，才能尝试上锁
        // 获取读锁数量
        int r = sharedCount(c);
        // 超出最大值 uint16，会导致无法正确存储和计算
        if (r == MAX_COUNT)
            throw new Error("Maximum lock count exceeded");
        // 尝试CAS数量+1
        if (compareAndSetState(c, c + SHARED_UNIT)) {
            //成功
            if (r == 0) {
                // 如果之前没有读锁，设置为第一个读锁
                firstReader = current;
                firstReaderHoldCount = 1;
            } else if (firstReader == current) {
                // 如果有读锁，但就是当前线程，则+1
                firstReaderHoldCount++;
            } else {
                // 获取已缓存的锁
                HoldCounter rh = cachedHoldCounter;
                // 如果没有或者id不一致
                if (rh == null ||
                    rh.tid != LockSupport.getThreadId(current))
                    // 更新当前 cachedHoldCounter为当前线程的hold对象
                    cachedHoldCounter = rh = readHolds.get();
                else if (rh.count == 0)
                    // 如果rh.count==0，则说明没有进入线程变量中，则放入
                    readHolds.set(rh);
                // 计数+1
                rh.count++;
            }
            // 成功获取读锁，返回即可
            return true;
        }
        // 继续循环
    }
}
```

- tryReadLock() 不会阻塞，因为是尝试，且会返回结果
- firstReaderHold一组对象，为第一个线程重入等提供快速处理
- 对于后续频繁重入的同一线程，cachedHoldCounter 提供了第二道快速通路

### 释放共享锁（读锁）
> tryReleaseShared

```java
@ReservedStackAccess
protected final boolean tryReleaseShared(int unused) {
    // 此处 `unused`永远为`1`。
    Thread current = Thread.currentThread();
    //  判断是否和第一个线程一致
    if (firstReader == current) {
        // assert firstReaderHoldCount > 0;
        if (firstReaderHoldCount == 1)
            // 置为空，表明第一个线程，即当前线程不再持有读锁
            firstReader = null;
        else
            // 计数-1
            firstReaderHoldCount--;
    } else {
        // 获取 cachedHoldCounter
        HoldCounter rh = cachedHoldCounter;
        if (rh == null ||
            rh.tid != LockSupport.getThreadId(current))
            rh = readHolds.get();
        // 数量计算
        int count = rh.count;
        if (count <= 1) {
            // 移除线程变量
            readHolds.remove();
            if (count <= 0)
                // 未获取锁（或者重入次数不对），但释放了
                throw unmatchedUnlockException();
        }
        // 减少当前
        --rh.count;
    }
    for (;;) {
        int c = getState();
        int nextc = c - SHARED_UNIT;
        // netxc是如果减一读锁后的实际值
        // CAS尝试
        if (compareAndSetState(c, nextc))
            // Releasing the read lock has no effect on readers,
            // but it may allow waiting writers to proceed if
            // both read and write locks are now free.
            // 如果nextc==0,则表明当前没有锁了。
            return nextc == 0;
    }
}
```

### 获取独占锁（写锁）
> tryWriteLock()

```java
    final boolean tryWriteLock() {
        Thread current = Thread.currentThread();
        int c = getState();
        if (c != 0) {
            // 如果锁数量不为0（包含读写锁）
            int w = exclusiveCount(c);
            // 获取写锁数量
            if (w == 0 || current != getExclusiveOwnerThread())
            // 由于锁总数不为0，此时只判断写锁数量，如果没有写锁，则说明只有读锁，由于此处需要拿独占锁，所以无法获取锁
            // 而如果w!=0,说明有线程拿到了写锁，则需要判断是不是重入，如果不是重入，则也无法拿到锁-> 这是为了避免线程先拿写锁，再拿读锁，又拿写锁的情况
                return false;
            // 锁越界
            if (w == MAX_COUNT)
                throw new Error("Maximum lock count exceeded");
        }
        // 走到这里，说明要不之前没有锁，要不锁被当前线程持有，且未越界
        // 尝试CAS更新锁状态
        if (!compareAndSetState(c, c + 1))
            return false;
        // 设置当前线程为持有线程
        setExclusiveOwnerThread(current);
        return true;
    }
```

### 释放独占锁（写锁）

> tryRelease

```java
/**
    * The synchronization state.
*/
private volatile int state;
...
/*
    * Note that tryRelease and tryAcquire can be called by
    * Conditions. So it is possible that their arguments contain
    * both read and write holds that are all released during a
    * condition wait and re-established in tryAcquire.
*/
@ReservedStackAccess
protected final boolean tryRelease(int releases) {
    // 是否是当前线程持有锁
    if (!isHeldExclusively())
        throw new IllegalMonitorStateException();
    // 获取下一次应该更新的state数据
    int nextc = getState() - releases;
    // 是否更新后被释放
    boolean free = exclusiveCount(nextc) == 0;
    if (free)
        setExclusiveOwnerThread(null);
    // 
    setState(nextc);
    return free;
}
...
protected final void setState(int newState) {
    state = newState;
}

```

没有使用比较并交换（CAS）是有原因的。因为在释放独占锁（写锁）的路径上，只有持有该写锁的线程才有权执行释放操作；既然只有“唯一的持有者”会修改状态，简单的算术更新加上对 volatile 字段的写入就足够保证正确性与可见性，无需用 CAS 做并发竞争保护。