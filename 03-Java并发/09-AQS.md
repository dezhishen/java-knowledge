# AQS
AbstractQueuedSynchronizer。AQS是一个用来构建锁和同步器的框架，使用AQS能简单且高效地构造出应用广泛的大量的同步器，比如我们提到的ReentrantLock，Semaphore，其他的诸如ReentrantReadWriteLock，SynchronousQueue，FutureTask等等皆是基于AQS的。当然，我们自己也能利用AQS非常轻松容易地构造出符合我们自己需求的同步器。

## 核心思想
AQS核心思想是，如果被请求的共享资源空闲，则将当前请求资源的线程设置为有效的工作线程，并且将共享资源设置为锁定状态。如果被请求的共享资源被占用，那么就需要一套线程阻塞等待以及被唤醒时锁分配的机制，这个机制AQS是用CLH队列锁实现的，即将暂时获取不到锁的线程加入到队列中。

```mermaid
sequenceDiagram
    participant ThreadA as 线程A
    participant ThreadB as 线程B
    participant AQS as AQS同步器
    participant OS as 操作系统（LockSupport）

    %% 线程A先加锁，成功立即返回
    ThreadA->>AQS: acquire()
    AQS->>ThreadA: tryAcquire (CAS成功)
    ThreadA-->>ThreadA: 获得锁，执行业务

    %% 线程B尝试加锁失败，进入队列
    ThreadB->>AQS: acquire()
    AQS->>ThreadB: tryAcquire (失败)
    ThreadB-->>ThreadB: 创建Node（Node.thread=ThreadB）
    ThreadB->>AQS: addWaiter/enq（入队列）
    
    loop ThreadB自旋
        ThreadB->>AQS: 检查前驱
        alt 前驱是head且tryAcquire成功
            ThreadB-->>AQS: 设置自己为新head
            ThreadB-->>ThreadB: 获得锁，退出循环
        else
            ThreadB-->>ThreadB: 设置前驱waitStatus=SIGNAL
            ThreadB->>OS: LockSupport.park()
            Note right of ThreadB: 线程B阻塞，挂起，暂停在此<br>等待被唤醒
            %% 被唤醒回到循环首继续尝试
        end
    end

    %% 线程A解锁
    ThreadA->>AQS: release()
    AQS->>ThreadA: tryRelease (CAS归0)
    alt 队列有后继结点
        AQS->>AQS: unparkSuccessor(head)
        AQS->>OS: LockSupport.unpark(B)
        OS-->>ThreadB: 唤醒ThreadB
        Note right of ThreadB: 被唤醒后继续执行acquire逻辑
    end
    ThreadA-->>ThreadA: 完成释放锁

    %% ThreadB被唤醒后的流程
    Note over ThreadB: 被唤醒后回到循环首部，尝试获取锁
    ThreadB->>AQS: 尝试tryAcquire成功
    ThreadB-->>AQS: 设置自己为新head
    ThreadB-->>ThreadB: 获得锁
```


### CLH队列锁
> CLH(Craig,Landin,and Hagersten)队列是一个虚拟的双向队列(虚拟的双向队列即不存在队列实例，仅存在结点之间的关联关系)。AQS是将每条请求共享资源的线程封装成一个CLH锁队列的一个结点(Node)来实现锁的分配。

CLH（Craig, Landin, and Hagersten）队列锁是一种高性能、自旋式的、基于链表的公平锁，在多核并发环境下常用于构建可伸缩、高吞吐的锁组件。
#### CLH核心思想
CLH队列锁是一种基于队列的自旋锁（Queue-based Spin Lock），采用“链表排队+本地自旋”策略。每个尝试获取锁的线程会按顺序在队列（链表）尾部排队，自旋观察其前驱节点的状态，自旋结束后才能获得锁。

主要目标：
- 公平性：锁的获取严格按照入队顺序进行，先来先服务。
- 减少总线开销：只自旋在自己的前驱节点，避免竞争“全局变量”，大大降低缓存一致性流量。
- 高并发可伸缩：适合多CPU/多核环境，性能随核数上升而可扩展。

#### CLH基本结构


