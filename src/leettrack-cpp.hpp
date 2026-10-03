// LeetTrack local IO helpers. Submitted solutions do not include this header.
#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iostream>
#include <limits>
#include <map>
#include <numeric>
#include <queue>
#include <set>
#include <sstream>
#include <stack>
#include <stdexcept>
#include <string>
#include <tuple>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
using namespace std;
struct ListNode {int val; ListNode* next; ListNode(int x=0,ListNode* p=nullptr):val(x),next(p){}};
struct TreeNode {int val; TreeNode *left,*right; TreeNode(int x=0,TreeNode* l=nullptr,TreeNode* r=nullptr):val(x),left(l),right(r){}};
inline string lt_json(const string& value) {
    string result="\"";
    const char* hex="0123456789abcdef";
    for(unsigned char c:value){
        if(c=='"'||c=='\\'){result+='\\';result+=c;}
        else if(c<32){result+="\\u00";result+=hex[c>>4];result+=hex[c&15];}
        else result+=c;
    }
    return result+'"';
}
inline string lt_json(char value){return lt_json(string(1,value));}
inline string lt_json(bool value){return value?"true":"false";}
template<class T,enable_if_t<is_arithmetic_v<T>,int> =0> string lt_json(T value){ostringstream s;s<<setprecision(17)<<value;return s.str();}
template<class T> string lt_json(const vector<T>& value){string s="[";for(size_t i=0;i<value.size();++i){if(i)s+=',';s+=lt_json(T(value[i]));}return s+"]";}
template<class T> void lt_fill(T& value,const T& seed){value=seed;}
template<class T> void lt_fill(vector<T>& value,const vector<T>& seed){for(size_t i=0;i<value.size();++i){T item=value[i];lt_fill(item,T(seed[i%seed.size()]));value[i]=item;}}
template<class T> void lt_print(const T& value){cout<<setprecision(12)<<value;}
inline void lt_print(const string& value){cout<<quoted(value);}
inline void lt_print(char value){cout<<quoted(string(1,value));}
template<class T> void lt_print(const vector<T>& value){for(size_t i=0;i<value.size();++i){if(i)cout<<' ';lt_print(T(value[i]));}}
template<class T> void printAnswer(const T& value){lt_print(value);cout<<'\n';}
inline void printAnswer(const string& value){cout<<value<<'\n';}
inline void printAnswer(char value){cout<<value<<'\n';}
template<class T> void printAnswer(const vector<vector<T>>& value){for(const auto& row:value){lt_print(row);cout<<'\n';}if(value.empty())cout<<'\n';}
