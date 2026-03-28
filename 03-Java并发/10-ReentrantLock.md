# ReentrantLock
类关系

```mermaid
graph BT
    Sync--extend-->AbstractQueuedSynchronizer
    FairSync--extend-->Sync
    NoFairSync--extend-->Sync

    ReentrantLock--implement-->Lock
    ReentrantLock-.内部类.->A["Sync/FairSync/NoFairSync"]
```

## AbstractQueuedSynchronizer
```java
/**
 * Queries whether any threads are waiting to acquire. Note that
 * because cancellations due to interrupts and timeouts may occur
 * at any time, a {@code true} return does not guarantee that any
 * other thread will ever acquire.
 *
 * @return {@code true} if there may be other threads waiting to acquire
 */
public final boolean hasQueuedThreads() {
    for (Node p = tail, h = head; p != h && p != null; p = p.prev)
        if (p.status >= 0)
            return true;
    return false;
}
```

## ReentrantLock

```java
final void lock() {
    if (!initialTryLock())
        acquire(1);
}
...
/**
 * Returns a {@link Condition} instance for use with this
 * {@link Lock} instance.
 *
 * <p>The returned {@link Condition} instance supports the same
 * usages as do the {@link Object} monitor methods ({@link
 * Object#wait() wait}, {@link Object#notify notify}, and {@link
 * Object#notifyAll notifyAll}) when used with the built-in
 * monitor lock.
 *
 * <ul>
 *
 * <li>If this lock is not held when any of the {@link Condition}
 * {@linkplain Condition#await() waiting} or {@linkplain
 * Condition#signal signalling} methods are called, then an {@link
 * IllegalMonitorStateException} is thrown.
 *
 * <li>When the condition {@linkplain Condition#await() waiting}
 * methods are called the lock is released and, before they
 * return, the lock is reacquired and the lock hold count restored
 * to what it was when the method was called.
 *
 * <li>If a thread is {@linkplain Thread#interrupt interrupted}
 * while waiting then the wait will terminate, an {@link
 * InterruptedException} will be thrown, and the thread's
 * interrupted status will be cleared.
 *
 * <li>Waiting threads are signalled in FIFO order.
 *
 * <li>The ordering of lock reacquisition for threads returning
 * from waiting methods is the same as for threads initially
 * acquiring the lock, which is in the default case not specified,
 * but for <em>fair</em> locks favors those threads that have been
 * waiting the longest.
 *
 * </ul>
 *
 * @return the Condition object
 */
public Condition newCondition() {
    return sync.newCondition();
}
```

## Sync
```java
final ConditionObject newCondition() {
    return new ConditionObject();
}
```

## NoFairSync

```java
final boolean initialTryLock() {
    Thread current = Thread.currentThread();
    // 直接尝试CAS
    if (compareAndSetState(0, 1)) { // first attempt is unguarded
    // 设置当前线程为锁持有线程
        setExclusiveOwnerThread(current);
        return true;
    } else if (getExclusiveOwnerThread() == current) {
        // 重入
        int c = getState() + 1;
        if (c < 0) // overflow
            throw new Error("Maximum lock count exceeded");
        setState(c);
        return true;
    } else
        return false;
}
```
## FairSync

```java
/**
 * Acquires only if reentrant or queue is empty.
 */
final boolean initialTryLock() {
    Thread current = Thread.currentThread();
    int c = getState();
    if (c == 0) {
        // 如果c==0，即没有上锁
        if (!hasQueuedThreads() && compareAndSetState(0, 1)) {
        // 如果没有queuedThreads，且CAS成功
            setExclusiveOwnerThread(current);
            return true;
        }
    } else if (getExclusiveOwnerThread() == current) {
        // 重入
        if (++c < 0) // overflow
            throw new Error("Maximum lock count exceeded");
        setState(c);
        return true;
    }
    return false;
}
```


## ConditionObject
```java
/**
 * Implements interruptible condition wait.
 * <ol>
 * <li>If current thread is interrupted, throw InterruptedException.
 * <li>Save lock state returned by {@link #getState}.
 * <li>Invoke {@link #release} with saved state as argument,
 *     throwing IllegalMonitorStateException if it fails.
 * <li>Block until signalled or interrupted.
 * <li>Reacquire by invoking specialized version of
 *     {@link #acquire} with saved state as argument.
 * <li>If interrupted while blocked in step 4, throw InterruptedException.
 * </ol>
 */
public final void await() throws InterruptedException {
    if (Thread.interrupted())
        throw new InterruptedException();
    // 构建条件节点
    ConditionNode node = new ConditionNode();
    int savedState = enableWait(node);
    LockSupport.setCurrentBlocker(this); // for back-compatibility
    boolean interrupted = false, cancelled = false, rejected = false;
    while (!canReacquire(node)) {
        if (interrupted |= Thread.interrupted()) {
            if (cancelled = (node.getAndUnsetStatus(COND) & COND) != 0)
                break;              // else interrupted after signal
        } else if ((node.status & COND) != 0) {
            try {
                if (rejected)
                    node.block();
                else
                    ForkJoinPool.managedBlock(node);
            } catch (RejectedExecutionException ex) {
                rejected = true;
            } catch (InterruptedException ie) {
                interrupted = true;
            }
        } else
            Thread.onSpinWait();    // awoke while enqueuing
    }
    LockSupport.setCurrentBlocker(null);
    node.clearStatus();
    acquire(node, savedState, false, false, false, 0L);
    if (interrupted) {
        if (cancelled) {
            unlinkCancelledWaiters(node);
            throw new InterruptedException();
        }
        Thread.currentThread().interrupt();
    }
}

```


## 条件队列的流程图
```mermaid
graph TD
    Start(["开始：线程准备等待条件"])
    Start --> A_await --> B_checkLock
    subgraph AwaitFlow [等待流程]
        A_await["调用: ConditionObject.await()系列方法"]
        B_checkLock{"是否持有关联锁（ReentrantLock）?"}
        Err["抛出异常: IllegalMonitorStateException"]
        C_add["ConditionObject.addConditionWaiter()将线程加入条件队列尾部"]
        D_release["ReentrantLock.fullyRelease(savedState)\n释放锁的重入计数并保存状态"]
        E_park["阻塞: LockSupport.park(this)\n线程挂起等待唤醒/中断/超时"]
        F_wakeup{"被唤醒的原因"}
        B_checkLock -- 是 --> C_add --> D_release --> E_park --> F_wakeup
        B_checkLock -- 否 --> Err
    end

    subgraph SignalFlow [唤醒与转移流程]
        S_call["另一线程调用: ConditionObject.signal() 或 signalAll()\n（必须持锁）"]
        G_transfer["ConditionObject.transferForSignal(node)\n将条件节点转为同步队列等待"]
        SA_loop["signalAll(): 循环调用 transferForSignal 转移所有节点"]
        S_call --> G_transfer
        SA_loop --> G_transfer
    end

    subgraph SyncQueue [同步队列入队与竞争锁]
        H_enq["AbstractQueuedSynchronizer.enq(node)\n将节点加入同步队列尾部"]
        I_acquire["AbstractQueuedSynchronizer.acquireQueued(node, savedState)\n竞争重新获取锁，直至成功"]
        J_unpark["LockSupport.unpark(thread) 或 同步队列竞争使线程恢复\nawait 方法返回"]
        H_enq --> I_acquire --> J_unpark
    end

    subgraph CancelCleanup [取消与清理]
        Cancel["ConditionObject.unlinkCancelledWaiters()\n移除已取消的条件队列节点，防止泄漏"]
        Cancel --> H_enq
    end

    subgraph AfterWake [唤醒后行为]
        K_recheck["重新检查条件谓词（通常在循环中）\n如果不满足则重新进入等待"]
        End(["结束：线程返回并继续执行"])
        J_unpark --> K_recheck --> End
    end

    %% 连接唤醒分支到转移流程或取消流程
    F_wakeup -- 被 signal/signalAll 转移 --> G_transfer
    F_wakeup -- 被中断 --> Cancel
    F_wakeup -- 超时 --> Cancel

    %% 转移后的入队与竞争
    G_transfer --> H_enq

    %% 其他连接
    Err --> End
```


## 对比
```mermaid
graph TD
  %% 总入口
  Start(["开始：线程尝试执行临界段或等待条件"])
  
  %% 共享子图：获取锁流程
  subgraph LockAcquire ["获取锁（任一实现）"]
    LA_lock["调用: 获取锁\n- ReentrantLock.lock() -> 抽象队列同步器.acquire\n- synchronized -> 尝试进入对象监视器"]
    LA_fail["无法获得锁 -> 同步队列入队并阻塞"]
    LA_enq["AbstractQueuedSynchronizer.enq(node)\n把线程加入同步队列尾部（仅 ReentrantLock 实现）"]
    LA_park["阻塞: LockSupport.park() 或 等待对象监视器"]
    LA_acquireReturn["获得锁后返回，进入临界区"]
    LA_lock --无法获得--> LA_enq
    LA_enq --> LA_park
    LA_lock --获得--> LA_acquireReturn
    LA_park --> LA_acquireReturn
  end

  %% Condition 等待流程
  subgraph ConditionAwait ["使用 Condition 的等待流程"]
    C1["线程调用: ConditionObject.await()"]
    C2["ConditionObject.addConditionWaiter() -> 条件队列尾部\n节点标记为 CONDITION"]
    C3["ReentrantLock.fullyRelease(savedState)\n释放锁的重入计数"]
    C4["阻塞: LockSupport.park()（线程挂起）"]
    C1 --> C2 --> C3 --> C4
  end

  %% Condition 唤醒流程（精准唤醒）
  subgraph ConditionSignal ["Condition 的唤醒/转移流程（精准）"]
    S_call["另一线程持锁调用: ConditionObject.signal() 或 signalAll()"]
    Transfer["ConditionObject.transferForSignal(node)\n从条件队列移除特定节点，准备转入同步队列"]
    Enq["AbstractQueuedSynchronizer.enq(node)\n把该节点加入同步队列尾部"]
    MaybeUnpark["如果适当，调用 LockSupport.unpark(thread) 或等候 unlock 时由 release 唤醒队首"]
    S_call --> Transfer --> Enq --> MaybeUnpark
  end

  %% synchronized wait/notifyAll 比较流程（粗暴唤醒）
  subgraph MonitorWaitNotify ["使用 synchronized + wait/notify/notifyAll 的情况"]
    M_wait["线程调用: object.wait()\n加入该对象的单一等待集并释放对象监视器，线程阻塞"]
    M_notifyAll["另一线程持监视器调用: object.notifyAll()\n将等待集和中全部线程变为可运行（全部唤醒）"]
    M_notify["另一线程持监视器调用: object.notify()\n任意选择一个等待线程唤醒（选择不可控）"]
    M_wait -->|notifyAll| M_notifyAll
    M_wait -->|notify| M_notify
  end

  %% notifyAll 后的结果（性能问题）
  subgraph NotifyAllConsequence ["notifyAll 导致的后果（虚拟群起）"]
    NA_awake["所有等待线程被唤醒并尝试重新获得监视器/锁"]
    NA_compete["大量线程瞬间竞争锁 -> 许多上下文切换与自旋/排队开销"]
    NA_wasted["不相关线程被唤醒导致无效重试（性能浪费）"]
    M_notifyAll --> NA_awake --> NA_compete --> NA_wasted
  end

  %% Condition 的优势点（指向图中）
  subgraph ConditionAdvantage ["Condition 的具体优势"]
    Adv1["多个 Condition 支持多个独立等待集合\n可以按需要精确唤醒某一集合"]
    Adv2["signal() 仅转移队首等待线程，避免全体唤醒"]
    Adv3["FIFO 风格的条件队列减少不必要竞争"]
    Adv1 --> Adv2 --> Adv3
  end

  %% 合并控制流
  Start --> LA_lock
  LA_acquireReturn -->|调用 await 时| ConditionAwait
  ConditionAwait -->|等待中| LA_park

  %% 当其他线程做出改变后，Condition 唤醒路径
  LA_acquireReturn -->|修改状态并想唤醒等待者| ConditionSignal

  %% 对比：若使用监视器等待
  LA_acquireReturn -->|"使用 object.wait()/notifyAll()"| MonitorWaitNotify

  %% 唤醒后回到获取锁的竞争
  MaybeUnpark --> LA_enq
  M_notify --> LA_enq
  NA_awake --> LA_enq

  %% 最终被唤醒线程重新竞争并继续
  LA_enq --> LA_park --> LA_acquireReturn

  %% 标注性能差异
  Adv1 --- ConditionSignal
  Adv2 --- MaybeUnpark
  NA_wasted --- MonitorWaitNotify

  %% 结束
  LA_acquireReturn --> End(["结束：线程获得锁并继续执行临界区/后续逻辑"])
```
```mermaid
graph TD
    subgraph "线程t1"
        t1lock["t1: lock.lock()"]-->runT1["运行生产者"]
        runT1-->full{{"满了?"}}
        full--否-->runT1
        full--是-->notFullAwait["notFull.await()"]
        runT1-.->notEmptySignal["唤醒notEmpty等待队列中的一线程"]
        notFullAwait-->addConditionNotFullWaiter[加入当前线程到notFull的等待队列中]
        addConditionNotFullWaiter-->fullyT1Release["完全释放锁(savedState)"]
        fullyT1Release-->parkT1["挂起T1线程"]
        parkT1-.-unparkT1[被唤醒]
        unparkT1-.->runT1
    end
    subgraph "线程t2"
        t2lock["t2: lock.lock()"]-->runT2["运行消费者"]
        runT2-->empty{{"空了?"}}
        empty--否-->runT2
        empty--是-->notEmptyAwait["notEmpty.await()"]
        notEmptyAwait-->addConditionNotEmptyWaiter[加入当前线程到notEmpty的等待队列中]
        addConditionNotEmptyWaiter-->fullyT2Release["完全释放锁(savedState)"]
        fullyT2Release-->parkT2["挂起T2线程"]
        runT2-.->notFullSignal["唤醒notFull等待队列中的一线程"]
        parkT2-.-unparkT2[被唤醒]
        unparkT2-.->runT2
    end
    notEmptySignal-.->unparkT2
        notFullSignal-.->unparkT1
```

- t1: lock.lock() -> 执行 -> 如果满 -> notFull.await()
- await: addConditionWaiter() -> fullyRelease(savedState) -> LockSupport.park()
- t2: lock.lock() -> 获取锁（因为 t1 已释放） -> take() -> notFull.signal()
- signal: transferForSignal(node) -> AbstractQueuedSynchronizer.enq(node)（转入同步队列）
- t2: lock.unlock() -> AQS.release -> unparkSuccessor(head) -> LockSupport.unpark(t1)
- t1: park 返回 -> acquireQueued(node, savedState) -> 重新获得锁 -> await 返回 -> 继续执行 put()