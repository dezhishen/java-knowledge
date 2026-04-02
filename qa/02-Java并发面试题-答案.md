# Java并发面试题（答案版）

## 第一题答案
问题：什么是Java并发中的三大问题（可见性、原子性、有序性）？为什么会出现这些问题？

### 30秒标准回答
- 可见性：一个线程修改共享变量后，其他线程不能立即看到。
- 原子性：一个操作被线程切换打断，导致执行不完整。
- 有序性：程序执行顺序可能被编译器/CPU重排。

根因分别对应：CPU缓存、多线程调度切换、指令重排优化。

### 90秒展开回答
- 可见性问题：各CPU核心有本地缓存，写入未及时回写主存，其他线程读到旧值。
- 原子性问题：看似一句代码（如i++）底层是读-改-写多步，线程切换会造成丢失更新。
- 有序性问题：在不破坏单线程语义前提下，编译器和CPU会重排指令，多线程下可能产生意外结果。

### 深入追问答案
1. 最隐蔽故障通常是原子性问题：
因为业务代码看起来只是“一句操作”，实际被拆成多条指令，问题往往是概率出现且难复现。

2. JMM关键手段：
- volatile：保证可见性，并提供一定有序性（禁止特定重排）。
- synchronized/Lock：同时保障可见性、原子性和有序性。
- final：在对象正确发布场景下提供初始化安全。
- Happens-Before规则：定义跨线程可见性与有序性的判定依据。

### 项目场景参考答案
并发计数器若直接count++，结果会小于预期。修复方案：
- 用AtomicInteger的原子方法。
- 对临界区加synchronized或Lock。

---

## 第二题答案
问题：Java线程有哪些状态？Thread.start() 和 Thread.run() 有什么区别？

### 30秒标准回答
线程状态：NEW、RUNNABLE、BLOCKED、WAITING、TIMED_WAITING、TERMINATED。

start()会启动新线程并进入RUNNABLE；run()只是普通方法调用，不会创建新线程。

### 90秒展开回答
- NEW：线程对象已创建未启动。
- RUNNABLE：可运行/运行中。
- BLOCKED：等待监视器锁。
- WAITING：无限等待其他线程显式唤醒。
- TIMED_WAITING：在限定时间内等待。
- TERMINATED：执行完毕或异常结束。

典型流转：NEW -> RUNNABLE -> BLOCKED/WAITING/TIMED_WAITING -> RUNNABLE -> TERMINATED。

### 深入追问答案
1. BLOCKED vs WAITING：
- BLOCKED是“抢锁失败后的被动等待锁”。
- WAITING是“主动等待通知事件（如wait/join/park）”。

2. 进入WAITING和TIMED_WAITING的方法：
- WAITING：Object.wait()、Thread.join()（无超时）、LockSupport.park()。
- TIMED_WAITING：Thread.sleep(t)、Object.wait(t)、Thread.join(t)、LockSupport.parkNanos()。

### 项目场景参考答案
生产者-消费者中，消费者发现队列空会wait进入WAITING并释放锁；被notify后转RUNNABLE，再次竞争锁时可能短暂BLOCKED，拿到锁后继续消费。

---

## 第三题答案
问题：synchronized 和 ReentrantLock 有什么区别？各适用什么场景？

### 30秒标准回答
二者都是悲观锁且可重入。区别在于：
- synchronized语法简单、自动释放锁。
- ReentrantLock能力更强，支持可中断、超时、公平锁、多个Condition，但需手动unlock。

### 90秒展开回答
- synchronized：JVM层实现，使用成本低，代码简洁，适合大多数场景。
- ReentrantLock：基于AQS，提供高级控制能力。
- 可中断：lockInterruptibly()。
- 超时尝试：tryLock(timeout)。
- 公平策略：new ReentrantLock(true)。
- 条件队列：newCondition()实现更细粒度等待/唤醒。

### 深入追问答案
1. 可重入含义：
同一线程持有锁后可再次进入同锁保护代码。若不可重入，线程在内部再次请求同锁会把自己阻塞，形成自陷死锁。

2. 选择建议：
- 优先synchronized：简单、安全、不易漏释放。
- 需要中断控制、超时失败、多个条件队列或公平策略时选ReentrantLock。

### 项目场景参考答案
缓存热点防击穿可采用“双重检查 + 受控加锁”：
- 先无锁读缓存（快路径）。
- 未命中再尝试加锁加载（慢路径）。
- 加锁后再次检查，避免重复回源。
- 结合tryLock和失败降级，避免大量线程长时间阻塞。