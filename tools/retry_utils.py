#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""网络请求重试工具：指数退避，处理超时/连接错误/5xx。

为 Python 爬虫提供统一的网络异常重试机制。重试仅针对单次网络请求，
不替换上层端点级联容错或并发控制逻辑。
"""

import random
import time
from functools import wraps

import requests


def retry_on_network_error(max_retries=3, base_delay=1.0, max_delay=8.0,
                           retryable_exceptions=None):
    """装饰器：对网络异常进行指数退避重试。

    默认重试场景：
      - requests.Timeout / requests.ConnectionError
      - requests.exceptions.ChunkedEncodingError
      - requests.HTTPError（由 5xx 响应自动抛出）

    Args:
        max_retries: 最大重试次数（不含首次调用）。
        base_delay: 首次重试基础延迟（秒）。
        max_delay: 单次重试延迟上限（秒）。
        retryable_exceptions: 可重试异常元组，None 时使用默认值。

    Returns:
        装饰后的函数，行为与原函数一致，仅在可重试异常时退避重试。
    """
    if retryable_exceptions is None:
        retryable_exceptions = (
            requests.Timeout,
            requests.ConnectionError,
            requests.exceptions.ChunkedEncodingError,
        )

    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(max_retries + 1):
                try:
                    result = func(*args, **kwargs)
                    # 检查响应对象是否为 5xx，若是则视为可重试错误
                    if isinstance(result, requests.Response) and 500 <= result.status_code < 600:
                        raise requests.HTTPError(
                            f"Server error {result.status_code} for {result.url}"
                        )
                    return result
                except retryable_exceptions as exc:
                    last_exc = exc
                    if attempt < max_retries:
                        delay = min(max_delay, base_delay * (2 ** attempt)) + random.uniform(0, 0.5)
                        time.sleep(delay)
                    else:
                        raise
                except requests.HTTPError as exc:
                    last_exc = exc
                    if attempt < max_retries:
                        delay = min(max_delay, base_delay * (2 ** attempt)) + random.uniform(0, 0.5)
                        time.sleep(delay)
                    else:
                        raise
            # 理论不可达，保险起见抛出最后一次异常
            if last_exc is not None:
                raise last_exc
            raise RuntimeError("retry_on_network_error: unreachable state")

        return wrapper

    return decorator


def with_retry(func, *args, max_retries=3, base_delay=1.0, max_delay=8.0, **kwargs):
    """函数式调用入口：对单次调用进行重试包装。

    适用于不便使用装饰器的临时调用场景（如对第三方 session 方法重试）。
    """
    decorated = retry_on_network_error(
        max_retries=max_retries,
        base_delay=base_delay,
        max_delay=max_delay,
    )(func)
    return decorated(*args, **kwargs)
